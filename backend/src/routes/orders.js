// Buying shares from the property owner (the "primary sale").
//
//  1. A verified investor asks for N shares   -> POST /orders
//     We hold the shares for a few minutes and create a Razorpay order.
//  2. The investor pays in Razorpay Checkout (test mode).
//  3. The app sends us Razorpay's proof       -> POST /orders/:id/verify
//     We check the signature, then move the shares from the owner's wallet
//     to the investor's wallet on the blockchain.
//  4. If the chain says no (e.g. the property got frozen), the order is
//     "failed" but stays paid. It can be retried -> POST /orders/:id/retry
const express = require("express");
const db = require("../db");
const chain = require("../chain");
const payments = require("../payments");
const config = require("../config");
const { HttpError } = require("../errors");
const { requireAuth, requireRole, requireKyc } = require("../auth");
const v = require("../validate");

const router = express.Router();

// Keeps one order under ₹10 crore, far below the size where numbers lose precision.
const MAX_AMOUNT_PAISE = 10_000_000_00;

const publicOrder = (o) => ({
  id: o.id,
  userId: o.user_id,
  property: { id: o.property_id, name: o.property_name, symbol: o.property_symbol },
  shares: o.shares,
  pricePerShare: Number(o.price_per_share),
  amount: Number(o.amount_paise) / 100,
  currency: o.currency,
  status: o.status,
  paymentMode: o.payment_mode,
  razorpayOrderId: o.razorpay_order_id,
  razorpayPaymentId: o.razorpay_payment_id,
  transaction: o.tx_hash,
  failureReason: o.failure_reason,
  expiresAt: o.expires_at,
  paidAt: o.paid_at,
  completedAt: o.completed_at,
  createdAt: o.created_at,
});

const SELECT = `SELECT o.*, p.name AS property_name, p.symbol AS property_symbol
                FROM orders o JOIN properties p ON p.id = o.property_id`;

/**
 * Shares already promised to someone: paid orders still waiting for their
 * transfer, and unpaid orders that haven't expired yet.
 */
async function reservedShares(propertyId, client = db) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(shares), 0)::int AS n FROM orders
     WHERE property_id = $1
       AND (status IN ('paid', 'failed') OR (status = 'created' AND expires_at > now()))`,
    [propertyId]
  );
  return rows[0].n;
}

/** Finds an order. Investors only see their own; admins see all. */
async function findOrder(id, user) {
  const { rows } = await db.query(`${SELECT} WHERE o.id = $1`, [id]);
  const order = rows[0];
  if (!order || (order.user_id !== user.id && user.role !== "admin")) throw new HttpError(404, "Order not found");
  return order;
}

/**
 * Moves the shares on the chain for an order that is already marked "paid".
 * Saves the result (completed or failed) and returns the updated order.
 */
async function deliverShares(orderId) {
  const { rows } = await db.query(
    `SELECT o.*, p.contract_address, buyer.wallet_address AS buyer_wallet, owner.wallet_key_enc AS owner_key
     FROM orders o
     JOIN properties p ON p.id = o.property_id
     JOIN users buyer ON buyer.id = o.user_id
     JOIN users owner ON owner.id = p.owner_id
     WHERE o.id = $1`,
    [orderId]
  );
  const o = rows[0];
  try {
    const ownerSigner = chain.userSigner({ wallet_key_enc: o.owner_key });
    const tx = await chain.transferShares(o.contract_address, ownerSigner, o.buyer_wallet, o.shares);
    await db.query(
      "UPDATE orders SET status = 'completed', tx_hash = $2, failure_reason = NULL, completed_at = now() WHERE id = $1",
      [o.id, tx]
    );
  } catch (err) {
    const reason = err.revert?.name
      ? `Blockchain refused: ${err.revert.name}`
      : "Could not reach the blockchain";
    if (!err.revert?.name) console.error(`Order ${o.id}: share transfer failed`, err);
    await db.query("UPDATE orders SET status = 'failed', failure_reason = $2 WHERE id = $1", [o.id, reason]);
  }
  const { rows: updated } = await db.query(`${SELECT} WHERE o.id = $1`, [o.id]);
  return updated[0];
}

/** Checks Razorpay's proof of payment, then delivers the shares. */
async function confirmPayment(order, proof) {
  if (order.status === "completed") return order; // already done (e.g. the app sent it twice)
  if (order.status !== "created") throw new HttpError(409, `This order is already ${order.status}`);

  const { razorpay_order_id: rzpOrderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = proof;
  if (rzpOrderId !== order.razorpay_order_id) throw new HttpError(400, "razorpay_order_id doesn't match this order");
  if (typeof paymentId !== "string" || !paymentId) throw new HttpError(400, "razorpay_payment_id is required");
  if (!payments.isValidSignature(rzpOrderId, paymentId, signature)) {
    throw new HttpError(400, "Payment signature is not valid");
  }

  // Only one request may move from "created" to "paid", so shares are sent once.
  const { rowCount } = await db.query(
    "UPDATE orders SET status = 'paid', razorpay_payment_id = $2, paid_at = now() WHERE id = $1 AND status = 'created'",
    [order.id, paymentId]
  );
  if (!rowCount) throw new HttpError(409, "This order is already being processed");
  return deliverShares(order.id);
}

// ---------- For investors ----------

// Body: { propertyId, shares }
router.post("/orders", requireAuth, requireRole("investor"), requireKyc, async (req, res) => {
  const body = req.body || {};
  const propertyId = v.positive(body, "propertyId", { integer: true, max: 2 ** 31 - 1 });
  const shares = v.positive(body, "shares", { integer: true, max: 1_000_000_000 });

  const { rows: props } = await db.query(
    `SELECT p.*, u.wallet_address AS owner_wallet FROM properties p JOIN users u ON u.id = p.owner_id WHERE p.id = $1`,
    [propertyId]
  );
  const p = props[0];
  if (!p) throw new HttpError(404, "Property not found");

  const onChain = await chain.readProperty(p.contract_address, p.owner_wallet);
  if (onChain.status !== "approved") throw new HttpError(409, "This property is not approved for sale yet");
  if (onChain.frozen) throw new HttpError(409, `This property is frozen: ${onChain.freezeReason}`);
  if (!(await chain.isWhitelisted(p.contract_address, req.user.wallet_address))) {
    throw new HttpError(409, "Your wallet is not on this property's whitelist yet. Please contact support");
  }

  const pricePaise = Math.round(Number(p.price_per_share) * 100);
  const amountPaise = pricePaise * shares;
  if (amountPaise > MAX_AMOUNT_PAISE) throw new HttpError(400, "One order can be at most ₹10 crore");

  // Lock the property row so two buyers can't reserve the same last shares.
  const client = await db.pool.connect();
  let orderId;
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM properties WHERE id = $1 FOR UPDATE", [p.id]);
    const available = onChain.ownerShares - (await reservedShares(p.id, client));
    if (shares > available) {
      throw new HttpError(409, available > 0 ? `Only ${available} shares are left` : "All shares are sold out");
    }
    const rzpOrderId = await payments.createOrder({ amountPaise, receipt: `bs-${p.ref}-${Date.now()}` });
    const { rows } = await client.query(
      `INSERT INTO orders (user_id, property_id, shares, price_per_share, amount_paise, payment_mode,
                           razorpay_order_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(mins => $8)) RETURNING id`,
      [req.user.id, p.id, shares, p.price_per_share, amountPaise, payments.mode(), rzpOrderId, config.orderMinutes]
    );
    orderId = rows[0].id;
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  const order = await findOrder(orderId, req.user);
  res.status(201).json({
    order: publicOrder(order),
    // Everything the app needs to open Razorpay Checkout.
    checkout: {
      mode: payments.mode(),
      key: config.razorpay.keyId || null,
      orderId: order.razorpay_order_id,
      amount: Number(order.amount_paise), // in paise
      currency: order.currency,
      name: "BrickShare",
      description: `${shares} shares of ${p.name}`,
    },
  });
});

router.get("/orders", requireAuth, async (req, res) => {
  const { rows } = await db.query(`${SELECT} WHERE o.user_id = $1 ORDER BY o.id DESC`, [req.user.id]);
  res.json({ orders: rows.map(publicOrder) });
});

router.get("/orders/:id", requireAuth, async (req, res) => {
  res.json({ order: publicOrder(await findOrder(req.params.id, req.user)) });
});

// Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature } (what Checkout returns)
router.post("/orders/:id/verify", requireAuth, async (req, res) => {
  const order = await findOrder(req.params.id, req.user);
  if (order.user_id !== req.user.id) throw new HttpError(403, "Only the buyer can confirm this payment");
  res.json({ order: publicOrder(await confirmPayment(order, req.body || {})) });
});

// Mock mode only: pretend the investor paid. Handy for testing without Razorpay.
router.post("/orders/:id/mock-pay", requireAuth, async (req, res) => {
  if (payments.mode() !== "mock") throw new HttpError(400, "Fake payments are off because Razorpay keys are set");
  const order = await findOrder(req.params.id, req.user);
  if (order.user_id !== req.user.id) throw new HttpError(403, "Only the buyer can pay for this order");
  const paid = await confirmPayment(order, payments.mockPayment(order.razorpay_order_id));
  res.json({ order: publicOrder(paid) });
});

// Paid, but the shares didn't arrive (e.g. the property was frozen). Try again.
router.post("/orders/:id/retry", requireAuth, async (req, res) => {
  const order = await findOrder(req.params.id, req.user);
  if (order.status !== "failed") throw new HttpError(409, `Only failed orders can be retried (this one is ${order.status})`);
  const { rowCount } = await db.query("UPDATE orders SET status = 'paid' WHERE id = $1 AND status = 'failed'", [order.id]);
  if (!rowCount) throw new HttpError(409, "This order is already being processed");
  res.json({ order: publicOrder(await deliverShares(order.id)) });
});

// ---------- For admins ----------

router.get("/admin/orders", requireAuth, requireRole("admin"), async (req, res) => {
  const params = [];
  let where = "";
  if (req.query.status) {
    params.push(req.query.status);
    where = "WHERE o.status = $1";
  }
  const { rows } = await db.query(`${SELECT} ${where} ORDER BY o.id DESC`, params);
  res.json({ orders: rows.map(publicOrder) });
});

module.exports = { router, reservedShares };
