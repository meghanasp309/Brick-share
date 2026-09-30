// Monthly rent, paid automatically.
//
// The owner sets a property's monthly rent once (e.g. ₹20,000). Every month
// BrickShare takes it from the owner's rupee wallet and shares it out with
// the normal rent payout (see rent.js): hold 10% of the shares, get 10% of
// the rent, straight into your wallet.
//
//  - Not enough money in the owner's wallet: nothing is taken, the reason is
//    shown on the owner page, and it tries again on the next check.
//  - Frozen property: nothing is taken. It pays once the property is unfrozen.
//  - Demo: "Pay now" pays the next month straight away, and RENT_MONTH_SECONDS
//    makes a "month" last only that many seconds.
const db = require("./db");
const cash = require("./cash");
const live = require("./live");
const rent = require("./rent");
const config = require("./config");

const rupees = (paise) => Number(paise) / 100;

const publicSchedule = (s) =>
  s && {
    propertyId: s.property_id,
    amount: rupees(s.amount_paise),
    active: s.active,
    nextDueAt: s.next_due_at,
    lastError: s.last_error,
    monthSeconds: config.rentMonthSeconds || null, // set = demo "months"
  };

/** SQL for "one month after <column>". */
const plusOneMonth = (column) =>
  config.rentMonthSeconds ? `${column} + make_interval(secs => ${config.rentMonthSeconds})` : `${column} + interval '1 month'`;

/** "October 2026" for the month the rent is for (Indian time). */
const periodOf = (due) => new Date(due).toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "Asia/Kolkata" });

async function find(propertyId) {
  const { rows } = await db.query("SELECT * FROM rent_schedules WHERE property_id = $1", [propertyId]);
  return rows[0] || null;
}

/** Sets (or changes) the monthly rent. The first month is paid on the next check. */
async function save(propertyId, amountPaise, active) {
  const { rows } = await db.query(
    `INSERT INTO rent_schedules (property_id, amount_paise, active, next_due_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (property_id) DO UPDATE SET
       amount_paise = EXCLUDED.amount_paise,
       active = EXCLUDED.active,
       -- Turned back on after a pause: start again from now, don't pay the missed months.
       next_due_at = CASE WHEN EXCLUDED.active AND NOT rent_schedules.active
                          THEN GREATEST(rent_schedules.next_due_at, now()) ELSE rent_schedules.next_due_at END,
       last_error = NULL,
       updated_at = now()
     RETURNING *`,
    [propertyId, amountPaise, active]
  );
  return rows[0];
}

/**
 * Pays one month's rent for a property if it is due (or right away with
 * `early`). Returns { payoutId } when paid, or { skipped: reason }.
 */
async function payMonth(propertyId, { early = false } = {}) {
  const result = await cash.inTransaction(async (client) => {
    // Lock the schedule so the same month is never paid twice.
    const { rows } = await client.query(
      `SELECT s.*, p.owner_id, p.status, p.frozen, p.freeze_reason, s.next_due_at <= now() AS due
       FROM rent_schedules s JOIN properties p ON p.id = s.property_id
       WHERE s.property_id = $1 FOR UPDATE OF s`,
      [propertyId]
    );
    const s = rows[0];
    if (!s || !s.active) return { skipped: "Monthly rent is not turned on for this property" };
    if (!s.due && !early) return { skipped: "Not due yet" };

    const skip = async (reason) => {
      await client.query("UPDATE rent_schedules SET last_error = $2 WHERE property_id = $1", [propertyId, reason]);
      return { skipped: reason };
    };
    if (s.status !== "approved") return skip("The property is not approved yet");
    if (s.frozen) return skip(`The property is frozen (${s.freeze_reason}). Rent starts again when it is unfrozen`);

    const amount = Number(s.amount_paise);
    await cash.lockBalance(client, s.owner_id);
    const available = await cash.availablePaise(client, s.owner_id);
    if (available < amount) {
      return skip(`Not enough money in your wallet: rent is ₹${rupees(amount)}, you have ₹${rupees(available)}. Add money to your wallet`);
    }

    // The due time makes this month's payout name unique, so it can't be paid twice.
    const due = new Date(s.next_due_at);
    const { rows: created } = await client.query(
      `INSERT INTO rent_payouts (property_id, paid_by, amount_paise, period, status, payment_mode, razorpay_order_id, paid_at)
       VALUES ($1, $2, $3, $4, 'paid', 'wallet', $5, now()) RETURNING id`,
      [propertyId, s.owner_id, amount, periodOf(due), `wallet_rent_${propertyId}_${due.getTime()}`]
    );
    const payoutId = created[0].id;
    await cash.addEntry(client, s.owner_id, "rent_paid", -amount, { rentPayoutId: payoutId });
    await client.query(
      `UPDATE rent_schedules SET next_due_at = ${plusOneMonth("next_due_at")}, last_error = NULL WHERE property_id = $1`,
      [propertyId]
    );
    return { payoutId, ownerId: s.owner_id };
  });

  if (result.payoutId) {
    try {
      live.toUser(result.ownerId, "wallet", await cash.summary(result.ownerId));
    } catch (err) {
      console.error("Could not send live update", err);
    }
    // Share it out: every holder gets their part in their wallet.
    await rent.distribute(result.payoutId);
  }
  return result;
}

/** Pays every month that is due. Runs by itself every RENT_CHECK_SECONDS. */
async function payDue() {
  const { rows } = await db.query(
    "SELECT property_id FROM rent_schedules WHERE active AND next_due_at <= now() ORDER BY property_id"
  );
  let paid = 0;
  for (const r of rows) {
    try {
      if ((await payMonth(r.property_id)).payoutId) paid++;
    } catch (err) {
      console.error(`Monthly rent for property ${r.property_id} failed`, err);
    }
  }
  return paid;
}

/** Starts the automatic monthly check. */
function start() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const paid = await payDue();
      if (paid) console.log(`Paid monthly rent for ${paid} propert${paid === 1 ? "y" : "ies"}`);
    } catch (err) {
      console.error("Monthly rent check failed", err);
    } finally {
      running = false;
    }
  };
  tick();
  return setInterval(tick, config.rentCheckSeconds * 1000);
}

module.exports = { publicSchedule, find, save, payMonth, payDue, start };
