// The rupee wallet: add money with Razorpay (test mode), see your balance,
// and withdraw to your bank (simulated). Buying on the order book spends
// from this wallet, and selling and rent pay into it.
const express = require("express");
const db = require("../db");
const cash = require("../cash");
const live = require("../live");
const payments = require("../payments");
const config = require("../config");
const { HttpError } = require("../errors");
const { requireAuth, requireRole, requireKyc } = require("../auth");
const v = require("../validate");

const router = express.Router();

// ₹1 crore per deposit or withdrawal.
const MAX_PAISE = 1_00_00_000_00;

const publicDeposit = (d) => ({
  id: d.id,
  amount: Number(d.amount_paise) / 100,
  status: d.status,
  paymentMode: d.payment_mode,
  razorpayOrderId: d.razorpay_order_id,
  razorpayPaymentId: d.razorpay_payment_id,
  paidAt: d.paid_at,
  createdAt: d.created_at,
});

async function findDeposit(id, user) {
  const { rows } = await db.query("SELECT * FROM deposits WHERE id = $1", [id]);
  if (!rows[0] || rows[0].user_id !== user.id) throw new HttpError(404, "Deposit not found");
  return rows[0];
}

async function sendWalletUpdate(userId) {
  live.toUser(userId, "wallet", await cash.summary(userId));
}

/**
 * Adds a paid deposit to the wallet, only once, even if the app and a
 * Razorpay webhook both report it. Returns the deposit, or null if it was
 * already added.
 */
async function creditDeposit(deposit, paymentId) {
  const paid = await cash.inTransaction(async (client) => {
    await cash.lockBalance(client, deposit.user_id);
    const { rows } = await client.query(
      `UPDATE deposits SET status = 'paid', razorpay_payment_id = $2, paid_at = now()
       WHERE id = $1 AND status = 'created' RETURNING *`,
      [deposit.id, paymentId]
    );
    if (!rows[0]) return null;
    await cash.addEntry(client, deposit.user_id, "deposit", Number(deposit.amount_paise), { depositId: deposit.id });
    return rows[0];
  });
  if (paid) await sendWalletUpdate(deposit.user_id);
  return paid;
}

/** Checks Razorpay's proof of payment, then adds the money to the wallet (only once). */
async function confirmDeposit(deposit, proof) {
  if (deposit.status === "paid") return deposit; // already done (e.g. the app sent it twice)
  const { razorpay_order_id: rzpOrderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = proof;
  if (rzpOrderId !== deposit.razorpay_order_id) throw new HttpError(400, "razorpay_order_id doesn't match this deposit");
  if (typeof paymentId !== "string" || !paymentId) throw new HttpError(400, "razorpay_payment_id is required");
  if (!payments.isValidSignature(rzpOrderId, paymentId, signature)) {
    throw new HttpError(400, "Payment signature is not valid");
  }
  const paid = await creditDeposit(deposit, paymentId);
  if (!paid) throw new HttpError(409, "This deposit is already being processed");
  return paid;
}

// Your balance and your last 50 money movements.
router.get("/wallet", requireAuth, async (req, res) => {
  const { rows } = await db.query(
    `SELECT e.*, COALESCE(t.property_id, r.property_id) AS property_id, t.shares, p.name AS property_name
     FROM cash_entries e
     LEFT JOIN trades t ON t.id = e.trade_id
     LEFT JOIN rent_payouts r ON r.id = e.rent_payout_id
     LEFT JOIN properties p ON p.id = COALESCE(t.property_id, r.property_id)
     WHERE e.user_id = $1 ORDER BY e.id DESC LIMIT 50`,
    [req.user.id]
  );
  res.json({
    wallet: await cash.summary(req.user.id),
    history: rows.map((e) => ({
      id: e.id,
      type: e.kind,
      amount: Number(e.amount_paise) / 100,
      depositId: e.deposit_id,
      tradeId: e.trade_id,
      rentPayoutId: e.rent_payout_id,
      property: e.property_id ? { id: e.property_id, name: e.property_name } : null,
      shares: e.shares ?? null,
      createdAt: e.created_at,
    })),
  });
});

// Body: { amount } in rupees. Returns the deposit and the Razorpay Checkout details.
router.post("/wallet/deposits", requireAuth, requireRole("investor"), requireKyc, async (req, res) => {
  const amountPaise = v.rupees(req.body || {}, "amount", { max: MAX_PAISE });
  const rzpOrderId = await payments.createOrder({ amountPaise, receipt: `bs-wallet-${req.user.id}-${Date.now()}` });
  const { rows } = await db.query(
    `INSERT INTO deposits (user_id, amount_paise, payment_mode, razorpay_order_id)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [req.user.id, amountPaise, payments.mode(), rzpOrderId]
  );
  res.status(201).json({
    deposit: publicDeposit(rows[0]),
    checkout: {
      mode: payments.mode(),
      key: config.razorpay.keyId || null,
      orderId: rzpOrderId,
      amount: amountPaise, // in paise
      currency: "INR",
      name: "BrickShare",
      description: "Add money to your BrickShare wallet",
    },
  });
});

router.get("/wallet/deposits", requireAuth, async (req, res) => {
  const { rows } = await db.query("SELECT * FROM deposits WHERE user_id = $1 ORDER BY id DESC", [req.user.id]);
  res.json({ deposits: rows.map(publicDeposit) });
});

// Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature } (what Checkout returns)
router.post("/wallet/deposits/:id/verify", requireAuth, async (req, res) => {
  const deposit = await findDeposit(req.params.id, req.user);
  res.json({ deposit: publicDeposit(await confirmDeposit(deposit, req.body || {})), wallet: await cash.summary(req.user.id) });
});

// Mock mode only: pretend the payment went through.
router.post("/wallet/deposits/:id/mock-pay", requireAuth, async (req, res) => {
  if (payments.mode() !== "mock") throw new HttpError(400, "Fake payments are off because Razorpay keys are set");
  const deposit = await findDeposit(req.params.id, req.user);
  const paid = await confirmDeposit(deposit, payments.mockPayment(deposit.razorpay_order_id));
  res.json({ deposit: publicDeposit(paid), wallet: await cash.summary(req.user.id) });
});

// Body: { amount } in rupees. Sends money back to your bank (simulated: test mode).
// Owners can withdraw too, because they receive rent for the shares they still hold.
router.post("/wallet/withdraw", requireAuth, requireRole("investor", "owner"), async (req, res) => {
  const amountPaise = v.rupees(req.body || {}, "amount", { max: MAX_PAISE });
  await cash.inTransaction(async (client) => {
    await cash.lockBalance(client, req.user.id);
    const available = await cash.availablePaise(client, req.user.id);
    if (amountPaise > available) {
      throw new HttpError(409, `You can withdraw at most ₹${(available / 100).toFixed(2)} right now`);
    }
    await cash.addEntry(client, req.user.id, "withdrawal", -amountPaise);
  });
  await sendWalletUpdate(req.user.id);
  res.json({ wallet: await cash.summary(req.user.id) });
});

module.exports = { router, sendWalletUpdate, creditDeposit };
