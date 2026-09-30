// Automatic rent payouts.
//
//  1. The owner (or an admin) pays a month's rent for a property with
//     Razorpay (test mode), e.g. ₹1,00,000.
//  2. BrickShare records the payout in the property's smart contract. The
//     contract takes a snapshot of who holds how many shares at that moment.
//  3. For every holder, the contract works out their part:
//       rent x (their shares / all shares), rounded down to the paisa.
//     Hold 2% of the shares, get 2% of the rent.
//  4. Each part is added to that holder's rupee wallet in the app, as one
//     database step. Rounding leftovers (a few paise) go to the owner.
//
// Frozen properties pay nothing: the contract refuses. The payout waits and
// is shared out automatically when the Land Authority unfreezes the property.
const db = require("./db");
const chain = require("./chain");
const cash = require("./cash");
const live = require("./live");
const payments = require("./payments");
const { HttpError } = require("./errors");

const rupees = (paise) => Number(paise) / 100;

const publicPayout = (r) => ({
  id: r.id,
  propertyId: r.property_id,
  amount: rupees(r.amount_paise),
  period: r.period,
  status: r.status,
  paymentMode: r.payment_mode,
  razorpayOrderId: r.razorpay_order_id,
  razorpayPaymentId: r.razorpay_payment_id,
  transaction: r.tx_hash,
  chainPayoutId: r.chain_payout_id,
  snapshotId: r.snapshot_id,
  failureReason: r.failure_reason,
  paidAt: r.paid_at,
  distributedAt: r.distributed_at,
  createdAt: r.created_at,
});

async function findPayout(id) {
  const { rows } = await db.query(
    `SELECT r.*, p.contract_address, p.owner_id FROM rent_payouts r
     JOIN properties p ON p.id = r.property_id WHERE r.id = $1`,
    [id]
  );
  if (!rows[0]) throw new HttpError(404, "Rent payout not found");
  return rows[0];
}

/** Checks Razorpay's proof of payment, then shares the rent out. */
async function confirmPayment(payout, proof) {
  if (payout.status === "created") {
    const { razorpay_order_id: rzpOrderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = proof;
    if (rzpOrderId !== payout.razorpay_order_id) throw new HttpError(400, "razorpay_order_id doesn't match this payout");
    if (typeof paymentId !== "string" || !paymentId) throw new HttpError(400, "razorpay_payment_id is required");
    if (!payments.isValidSignature(rzpOrderId, paymentId, signature)) {
      throw new HttpError(400, "Payment signature is not valid");
    }
    // Only the first request marks it paid, even if the app sends it twice.
    await db.query(
      `UPDATE rent_payouts SET status = 'paid', razorpay_payment_id = $2, paid_at = now()
       WHERE id = $1 AND status = 'created'`,
      [payout.id, paymentId]
    );
  }
  await distribute(payout.id);
  return findPayout(payout.id);
}

// Payouts being shared out right now, so one payout never runs twice at once.
const inFlight = new Map();

/** Records a paid payout on the chain and credits every holder. Safe to call again. */
function distribute(payoutId) {
  if (!inFlight.has(payoutId)) {
    const run = doDistribute(payoutId).catch(async (err) => {
      console.error(`Rent payout ${payoutId}: sharing out failed`, err);
      await setFailure(payoutId, "Something went wrong while sharing out the rent. Try again later");
    });
    inFlight.set(payoutId, run.finally(() => inFlight.delete(payoutId)));
  }
  return inFlight.get(payoutId);
}

const setFailure = (id, reason) =>
  db.query("UPDATE rent_payouts SET failure_reason = $2 WHERE id = $1 AND status = 'paid'", [id, reason]);

async function doDistribute(payoutId) {
  const r = await findPayout(payoutId);
  if (r.status !== "paid") return;
  const contract = r.contract_address;
  // Our name for this payout in the contract. The contract refuses a name it
  // has seen before, so the same rent can never be paid out twice.
  const ref = `rent:${r.razorpay_order_id}`;

  let chainId = 0;
  try {
    // Sent before (e.g. the server restarted while waiting)? Wait for that one first.
    if (r.tx_hash) await chain.transactionOutcome(r.tx_hash);
    chainId = await chain.payoutIdByRef(contract, ref);
    if (!chainId) {
      await chain.distributeRentTracked(contract, r.amount_paise, ref, (hash) =>
        db.query("UPDATE rent_payouts SET tx_hash = $2 WHERE id = $1", [r.id, hash])
      );
      chainId = await chain.payoutIdByRef(contract, ref);
    }
  } catch (err) {
    const name = err.revert?.name;
    if (name === "DuplicatePayout") {
      chainId = await chain.payoutIdByRef(contract, ref); // another server got there first
    } else {
      let reason = "Could not reach the blockchain. Try again later";
      if (name === "PropertyFrozen") reason = `The property is frozen (${err.revert.args[0]}). Rent will be paid when it is unfrozen`;
      else if (name) reason = `Blockchain refused: ${name}`;
      else if (err.code === "CALL_EXCEPTION") reason = "Blockchain refused the payout";
      else console.error(`Rent payout ${r.id}: could not record it on the chain`, err);
      await setFailure(r.id, reason);
      return;
    }
  }
  if (!chainId) {
    await setFailure(r.id, "The blockchain has not confirmed the payout yet. Try again later");
    return;
  }

  // Ask the contract how much each holder gets.
  const { snapshotId } = await chain.rentPayout(contract, chainId);
  const wallets = await chain.everHolders(contract);
  const owed = await Promise.all(wallets.map((w) => chain.rentOwed(contract, chainId, w)));
  const { rows: users } = await db.query(
    "SELECT id, wallet_address FROM users WHERE lower(wallet_address) = ANY($1)",
    [wallets.map((w) => w.toLowerCase())]
  );
  const userByWallet = new Map(users.map((u) => [u.wallet_address.toLowerCase(), u.id]));
  const credits = new Map(); // user id -> paise
  wallets.forEach((w, i) => {
    const userId = userByWallet.get(w.toLowerCase());
    if (userId && owed[i] > 0) credits.set(userId, (credits.get(userId) || 0) + owed[i]);
  });
  // Rounding leftovers (and anything owed to a wallet we don't know) go to the owner.
  const given = [...credits.values()].reduce((a, b) => a + b, 0);
  const leftover = Number(r.amount_paise) - given;
  if (leftover > 0) credits.set(r.owner_id, (credits.get(r.owner_id) || 0) + leftover);

  const done = await cash.inTransaction(async (client) => {
    const { rows } = await client.query("SELECT status FROM rent_payouts WHERE id = $1 FOR UPDATE", [r.id]);
    if (rows[0].status !== "paid") return false; // already shared out
    // Lock wallets lowest id first, like trade settlement, so they can't block each other.
    const ids = [...credits.keys()].sort((a, b) => a - b);
    for (const id of ids) {
      await cash.lockBalance(client, id);
      await cash.addEntry(client, id, "rent", credits.get(id), { rentPayoutId: r.id });
    }
    await client.query(
      `UPDATE rent_payouts SET status = 'distributed', chain_payout_id = $2, snapshot_id = $3,
         failure_reason = NULL, distributed_at = now() WHERE id = $1`,
      [r.id, chainId, snapshotId]
    );
    return true;
  });
  if (!done) return;

  for (const id of credits.keys()) {
    try {
      live.toUser(id, "wallet", await cash.summary(id));
      live.toUser(id, "rent", { payoutId: r.id, propertyId: r.property_id, amount: rupees(credits.get(id)) });
    } catch (err) {
      console.error("Could not send live update", err);
    }
  }
}

/** Shares out every paid payout of a property that is still waiting (e.g. after an unfreeze). */
async function retryWaiting(propertyId) {
  const { rows } = await db.query(
    "SELECT id FROM rent_payouts WHERE property_id = $1 AND status = 'paid' ORDER BY id",
    [propertyId]
  );
  for (const r of rows) await distribute(r.id);
  return rows.length;
}

/** After a restart: finish every payout that was paid but not shared out. */
async function resumeWaiting() {
  const { rows } = await db.query("SELECT id FROM rent_payouts WHERE status = 'paid' ORDER BY id");
  for (const r of rows) await distribute(r.id);
  return rows.length;
}

module.exports = { publicPayout, findPayout, confirmPayment, distribute, retryWaiting, resumeWaiting };
