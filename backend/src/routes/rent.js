// Rent payouts: the owner (or an admin) pays rent, and it is shared out
// automatically to everyone holding shares. See src/rent.js for how.
const express = require("express");
const db = require("../db");
const chain = require("../chain");
const rent = require("../rent");
const monthlyRent = require("../monthlyRent");
const payments = require("../payments");
const config = require("../config");
const { HttpError } = require("../errors");
const { requireAuth, requireRole } = require("../auth");
const v = require("../validate");

const router = express.Router();

// ₹1 crore per payout.
const MAX_PAISE = 1_00_00_000_00;

const canSee = (user, payout) => user.role === "admin" || payout.paid_by === user.id;

async function findVisiblePayout(id, user) {
  const payout = await rent.findPayout(id);
  if (!canSee(user, payout)) throw new HttpError(404, "Rent payout not found");
  return payout;
}

// Body: { amount } in rupees, and an optional { period }, e.g. "October 2026".
// Returns the payout and the Razorpay Checkout details.
router.post("/properties/:id/rent", requireAuth, requireRole("owner", "admin"), async (req, res) => {
  const { rows } = await db.query("SELECT * FROM properties WHERE id = $1", [req.params.id]);
  const p = rows[0];
  if (!p || (req.user.role === "owner" && p.owner_id !== req.user.id)) throw new HttpError(404, "Property not found");
  const amountPaise = v.rupees(req.body || {}, "amount", { max: MAX_PAISE });
  const period = v.text(req.body || {}, "period", { max: 50, optional: true });

  if (p.status !== "approved") throw new HttpError(409, "Rent can only be paid for an approved property");
  if (p.frozen) throw new HttpError(409, `This property is frozen (${p.freeze_reason}). Frozen properties pay no rent`);
  if (!(await chain.hasPhase5Features(p.contract_address))) {
    throw new HttpError(409, "This property was listed before rent payouts existed. List it again to pay rent");
  }

  const rzpOrderId = await payments.createOrder({ amountPaise, receipt: `bs-rent-${p.id}-${Date.now()}` });
  const { rows: created } = await db.query(
    `INSERT INTO rent_payouts (property_id, paid_by, amount_paise, period, payment_mode, razorpay_order_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [p.id, req.user.id, amountPaise, period, payments.mode(), rzpOrderId]
  );
  res.status(201).json({
    payout: rent.publicPayout(created[0]),
    checkout: {
      mode: payments.mode(),
      key: config.razorpay.keyId || null,
      orderId: rzpOrderId,
      amount: amountPaise, // in paise
      currency: "INR",
      name: "BrickShare",
      description: `Rent for ${p.name}${period ? ` (${period})` : ""}`,
    },
  });
});

// ---------- Monthly rent (paid automatically from the owner's wallet) ----------

async function findOwnProperty(id, user) {
  const { rows } = await db.query("SELECT * FROM properties WHERE id = $1", [id]);
  const p = rows[0];
  if (!p || (user.role === "owner" && p.owner_id !== user.id)) throw new HttpError(404, "Property not found");
  return p;
}

// Monthly rent of your properties (admins see all).
router.get("/rent-schedules", requireAuth, requireRole("owner", "admin"), async (req, res) => {
  const { rows } = await db.query(
    `SELECT s.* FROM rent_schedules s JOIN properties p ON p.id = s.property_id
     ${req.user.role === "admin" ? "" : "WHERE p.owner_id = $1"} ORDER BY s.property_id`,
    req.user.role === "admin" ? [] : [req.user.id]
  );
  res.json({ schedules: rows.map(monthlyRent.publicSchedule) });
});

router.get("/properties/:id/rent-schedule", requireAuth, requireRole("owner", "admin"), async (req, res) => {
  const p = await findOwnProperty(req.params.id, req.user);
  res.json({ schedule: monthlyRent.publicSchedule(await monthlyRent.find(p.id)) });
});

// Body: { amount } in rupees, and optional { active: false } to stop it.
// The first month is paid within a minute, then once every month.
router.put("/properties/:id/rent-schedule", requireAuth, requireRole("owner", "admin"), async (req, res) => {
  const p = await findOwnProperty(req.params.id, req.user);
  const body = req.body || {};
  const amountPaise = v.rupees(body, "amount", { max: MAX_PAISE });
  if (body.active !== undefined && typeof body.active !== "boolean") throw new HttpError(400, "active must be true or false");
  const active = body.active !== false;
  if (p.status !== "approved") throw new HttpError(409, "Monthly rent can only be set for an approved property");
  if (!(await chain.hasPhase5Features(p.contract_address))) {
    throw new HttpError(409, "This property was listed before rent payouts existed. List it again to pay rent");
  }
  const schedule = await monthlyRent.save(p.id, amountPaise, active);
  res.json({ schedule: monthlyRent.publicSchedule(schedule) });
});

// Demo button: pay the next month's rent right now instead of waiting.
router.post("/properties/:id/rent-schedule/pay-now", requireAuth, requireRole("owner", "admin"), async (req, res) => {
  const p = await findOwnProperty(req.params.id, req.user);
  const { payoutId, skipped } = await monthlyRent.payMonth(p.id, { early: true });
  if (skipped) throw new HttpError(409, skipped);
  res.json({
    payout: rent.publicPayout(await rent.findPayout(payoutId)),
    schedule: monthlyRent.publicSchedule(await monthlyRent.find(p.id)),
  });
});

// Every rent payout of a property that was shared out (anyone can see these).
router.get("/properties/:id/rent", async (req, res) => {
  const { rows } = await db.query(
    "SELECT * FROM rent_payouts WHERE property_id = $1 AND status = 'distributed' ORDER BY id DESC",
    [req.params.id]
  );
  res.json({ payouts: rows.map(rent.publicPayout) });
});

// Rent you received, newest first, and the total.
router.get("/rent/received", requireAuth, async (req, res) => {
  const { rows } = await db.query(
    `SELECT e.id, e.amount_paise, e.created_at, r.id AS payout_id, r.period, r.amount_paise AS total_paise,
            r.snapshot_id, r.tx_hash, p.id AS property_id, p.name AS property_name
     FROM cash_entries e
     JOIN rent_payouts r ON r.id = e.rent_payout_id
     JOIN properties p ON p.id = r.property_id
     WHERE e.user_id = $1 AND e.kind = 'rent'
     ORDER BY e.id DESC`,
    [req.user.id]
  );
  res.json({
    total: rows.reduce((sum, e) => sum + Number(e.amount_paise), 0) / 100,
    received: rows.map((e) => ({
      id: e.id,
      amount: Number(e.amount_paise) / 100,
      property: { id: e.property_id, name: e.property_name },
      payoutId: e.payout_id,
      period: e.period,
      totalRent: Number(e.total_paise) / 100,
      snapshotId: e.snapshot_id,
      transaction: e.tx_hash,
      createdAt: e.created_at,
    })),
  });
});

// Payouts you paid (admins see all). Optional ?status=paid shows ones still waiting.
router.get("/rent", requireAuth, requireRole("owner", "admin"), async (req, res) => {
  const params = [];
  const where = [];
  if (req.user.role !== "admin") {
    params.push(req.user.id);
    where.push(`paid_by = $${params.length}`);
  }
  if (req.query.status) {
    params.push(req.query.status);
    where.push(`status = $${params.length}`);
  }
  const { rows } = await db.query(
    `SELECT * FROM rent_payouts ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC`,
    params
  );
  res.json({ payouts: rows.map(rent.publicPayout) });
});

router.get("/rent/:id", requireAuth, async (req, res) => {
  res.json({ payout: rent.publicPayout(await findVisiblePayout(req.params.id, req.user)) });
});

// Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature } (what Checkout returns)
router.post("/rent/:id/verify", requireAuth, async (req, res) => {
  const payout = await findVisiblePayout(req.params.id, req.user);
  res.json({ payout: rent.publicPayout(await rent.confirmPayment(payout, req.body || {})) });
});

// Mock mode only: pretend the payment went through.
router.post("/rent/:id/mock-pay", requireAuth, async (req, res) => {
  if (payments.mode() !== "mock") throw new HttpError(400, "Fake payments are off because Razorpay keys are set");
  const payout = await findVisiblePayout(req.params.id, req.user);
  const proof = payments.mockPayment(payout.razorpay_order_id);
  res.json({ payout: rent.publicPayout(await rent.confirmPayment(payout, proof)) });
});

// Try sharing out a paid payout again (e.g. it waited because the chain was down).
router.post("/rent/:id/retry", requireAuth, async (req, res) => {
  const payout = await findVisiblePayout(req.params.id, req.user);
  if (payout.status !== "paid") throw new HttpError(409, `Only paid payouts can be retried (this one is ${payout.status})`);
  await rent.distribute(payout.id);
  res.json({ payout: rent.publicPayout(await rent.findPayout(payout.id)) });
});

module.exports = router;
