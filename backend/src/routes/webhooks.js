// Razorpay webhooks: Razorpay tells our server directly that a payment went
// through. This is the backup for when the investor pays but closes the
// browser before the app can send us the proof (POST .../verify).
//
// Set it up in the Razorpay dashboard (Test Mode > Webhooks):
//   URL:    https://<your server>/payments/webhook
//   Secret: the same value as RAZORPAY_WEBHOOK_SECRET in backend/.env
//   Events: payment.captured and order.paid
//
// Razorpay signs each webhook with that secret, so nobody else can fake one.
const express = require("express");
const db = require("../db");
const payments = require("../payments");
const rent = require("../rent");
const config = require("../config");
const { HttpError } = require("../errors");
const { markPaid: markOrderPaid } = require("./orders");
const { creditDeposit } = require("./wallet");

const router = express.Router();

const HANDLED = ["payment.captured", "order.paid"];

const inBackground = (label, work) =>
  work.catch((err) => console.error(`Webhook: ${label} failed`, err));

router.post("/payments/webhook", async (req, res) => {
  if (!config.razorpay.webhookSecret) throw new HttpError(503, "Webhooks are off. Set RAZORPAY_WEBHOOK_SECRET to turn them on");
  if (!payments.isValidWebhook(req.rawBody, req.get("X-Razorpay-Signature"))) {
    throw new HttpError(400, "Webhook signature is not valid");
  }
  const { event, payload } = req.body || {};
  if (!HANDLED.includes(event)) return res.json({ ok: true, ignored: event || null });

  const payment = payload?.payment?.entity || {};
  const rzpOrderId = payment.order_id || payload?.order?.entity?.id;
  const paymentId = payment.id;
  const amount = Number(payment.amount);
  if (!rzpOrderId || !paymentId) throw new HttpError(400, "Webhook has no order or payment id");

  // The Razorpay order belongs to one of: a share order, a wallet deposit, or a rent payout.
  const find = async (table) =>
    (await db.query(`SELECT * FROM ${table} WHERE razorpay_order_id = $1`, [rzpOrderId])).rows[0];
  const [order, deposit, payout] = await Promise.all([find("orders"), find("deposits"), find("rent_payouts")]);
  const match = order || deposit || payout;
  if (!match) return res.json({ ok: true, ignored: "unknown order" });
  if (amount !== Number(match.amount_paise)) throw new HttpError(400, "Paid amount doesn't match");

  // Reply fast (Razorpay waits only a few seconds). The blockchain step runs after.
  if (order) {
    if (order.status === "created") inBackground(`order ${order.id}`, markOrderPaid(order.id, paymentId));
    return res.json({ ok: true, order: order.id });
  }
  if (deposit) {
    if (deposit.status === "created") await creditDeposit(deposit, paymentId);
    return res.json({ ok: true, deposit: deposit.id });
  }
  if (payout.status === "created") {
    await rent.markPaid(payout.id, paymentId);
    inBackground(`rent payout ${payout.id}`, rent.distribute(payout.id));
  }
  res.json({ ok: true, rentPayout: payout.id });
});

module.exports = router;
