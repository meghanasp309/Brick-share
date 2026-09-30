// Trading between investors (the order book) and market data for charts.
const express = require("express");
const db = require("../db");
const trading = require("../trading");
const { HttpError } = require("../errors");
const { requireAuth, requireRole, requireKyc } = require("../auth");
const v = require("../validate");

const router = express.Router();

const idParam = (value) => v.positive({ id: value }, "id", { integer: true, max: 2 ** 31 - 1 });

// ---------- Market data (anyone can see it) ----------

// Every approved property with its price, 24h change and volume.
router.get("/market", async (_req, res) => {
  const { rows } = await db.query("SELECT id FROM properties WHERE status = 'approved' AND deleted_at IS NULL ORDER BY id");
  res.json({ markets: await Promise.all(rows.map((p) => trading.ticker(p.id))) });
});

// One property: price, order book and latest trades.
router.get("/market/:propertyId", async (req, res) => {
  const id = idParam(req.params.propertyId);
  const ticker = await trading.ticker(id);
  const [orderBook, trades] = await Promise.all([trading.orderBook(id), trading.recentTrades(id, 20)]);
  res.json({ ticker, orderBook, trades });
});

router.get("/market/:propertyId/orderbook", async (req, res) => {
  const id = idParam(req.params.propertyId);
  await trading.ticker(id); // 404 if the property doesn't exist
  res.json(await trading.orderBook(id));
});

router.get("/market/:propertyId/trades", async (req, res) => {
  const id = idParam(req.params.propertyId);
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  res.json({ trades: await trading.recentTrades(id, limit) });
});

// Price chart data. ?interval=1m, 5m, 15m, 1h (default) or 1d, and ?limit= (max 500)
router.get("/market/:propertyId/candles", async (req, res) => {
  const id = idParam(req.params.propertyId);
  const interval = req.query.interval || "1h";
  if (!trading.INTERVALS[interval]) {
    throw new HttpError(400, `interval must be one of: ${Object.keys(trading.INTERVALS).join(", ")}`);
  }
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  res.json({ propertyId: id, interval, candles: await trading.candles(id, interval, limit) });
});

// ---------- Your orders and trades ----------

// Body: { propertyId, side: "buy" or "sell", shares, price } (price per share in rupees)
router.post("/trading/orders", requireAuth, requireRole("investor"), requireKyc, async (req, res) => {
  const body = req.body || {};
  const propertyId = v.positive(body, "propertyId", { integer: true, max: 2 ** 31 - 1 });
  const side = v.oneOf(body, "side", ["buy", "sell"]);
  const shares = v.positive(body, "shares", { integer: true, max: 1_000_000_000 });
  const pricePaise = v.rupees(body, "price", { max: trading.MAX_PRICE_PAISE });
  const { order, trades } = await trading.placeOrder(req.user, { propertyId, side, shares, pricePaise });
  res.status(201).json({
    order: trading.publicOrder(order),
    trades: trades.map((t) => trading.myTrade(t, req.user.id)),
  });
});

// Your orders. Optional filters: ?status=open|filled|cancelled and ?propertyId=
router.get("/trading/orders", requireAuth, async (req, res) => {
  const params = [req.user.id];
  let where = "user_id = $1";
  if (req.query.status) {
    params.push(req.query.status);
    where += ` AND status = $${params.length}`;
  }
  if (req.query.propertyId) {
    params.push(req.query.propertyId);
    where += ` AND property_id = $${params.length}`;
  }
  const { rows } = await db.query(`SELECT * FROM book_orders WHERE ${where} ORDER BY id DESC`, params);
  res.json({ orders: rows.map(trading.publicOrder) });
});

router.get("/trading/orders/:id", requireAuth, async (req, res) => {
  const { rows } = await db.query("SELECT * FROM book_orders WHERE id = $1", [idParam(req.params.id)]);
  if (!rows[0] || rows[0].user_id !== req.user.id) throw new HttpError(404, "Order not found");
  const { rows: trades } = await db.query(
    "SELECT * FROM trades WHERE buy_order_id = $1 OR sell_order_id = $1 ORDER BY id",
    [rows[0].id]
  );
  res.json({ order: trading.publicOrder(rows[0]), trades: trades.map((t) => trading.myTrade(t, req.user.id)) });
});

// Cancel what's left of an open order.
router.delete("/trading/orders/:id", requireAuth, async (req, res) => {
  res.json({ order: trading.publicOrder(await trading.cancelOrder(req.user, idParam(req.params.id))) });
});

// Your trades, newest first.
router.get("/trading/trades", requireAuth, async (req, res) => {
  const { rows } = await db.query(
    "SELECT * FROM trades WHERE buyer_id = $1 OR seller_id = $1 ORDER BY id DESC",
    [req.user.id]
  );
  res.json({ trades: rows.map((t) => trading.myTrade(t, req.user.id)) });
});

// A trade whose shares couldn't move (e.g. the property was frozen). Try again.
router.post("/trading/trades/:id/retry", requireAuth, async (req, res) => {
  const trade = await trading.retryTrade(req.user, idParam(req.params.id));
  const mine = trade.buyer_id === req.user.id || trade.seller_id === req.user.id;
  res.json({
    trade: mine
      ? trading.myTrade(trade, req.user.id)
      : { ...trading.marketTrade(trade), transaction: trade.tx_hash, failureReason: trade.failure_reason },
  });
});

// ---------- For admins ----------

router.get("/admin/trades", requireAuth, requireRole("admin"), async (req, res) => {
  const params = [];
  let where = "";
  if (req.query.status) {
    params.push(req.query.status);
    where = "WHERE status = $1";
  }
  const { rows } = await db.query(`SELECT * FROM trades ${where} ORDER BY id DESC`, params);
  res.json({
    trades: rows.map((t) => ({
      ...trading.marketTrade(t),
      buyerId: t.buyer_id,
      sellerId: t.seller_id,
      transaction: t.tx_hash,
      failureReason: t.failure_reason,
    })),
  });
});

module.exports = router;
