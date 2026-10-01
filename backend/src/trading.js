// Stock-app trading between investors.
//
// The ORDER BOOK is a list of offers for one property:
//   bids = buy orders  ("I'll pay up to ₹105 per share")
//   asks = sell orders ("I'll sell for at least ₹110 per share")
//
// MATCHING (price-time priority): a new order trades with the best price on
// the other side first; at the same price, the older order goes first. The
// trade happens at the price of the order that was already waiting.
// Whatever is left of the new order waits on the book.
//
// SETTLEMENT: each match becomes a trade. The shares then move on the
// blockchain from the seller's wallet to the buyer's. Only when the chain
// confirms it does the money move from the buyer's wallet to the seller's.
// Until then the buyer's money and the seller's shares stay held.
const db = require("./db");
const chain = require("./chain");
const cash = require("./cash");
const live = require("./live");
const holdingLimit = require("./holdingLimit");
const { HttpError } = require("./errors");

// Limits that keep numbers far below where they would lose precision.
const MAX_PRICE_PAISE = 10_00_000_00; // ₹10 lakh per share
const MAX_ORDER_PAISE = 1_00_00_000_00; // ₹1 crore per order

const rupees = (paise) => Number(paise) / 100;

const publicOrder = (o) => ({
  id: o.id,
  userId: o.user_id,
  propertyId: o.property_id,
  side: o.side,
  price: rupees(o.price_paise),
  shares: o.shares,
  filledShares: o.filled_shares,
  remainingShares: o.status === "open" ? o.shares - o.filled_shares : 0,
  status: o.status,
  createdAt: o.created_at,
  updatedAt: o.updated_at,
});

/** A trade as everyone sees it on the market (no names). */
const marketTrade = (t) => ({
  id: t.id,
  propertyId: t.property_id,
  shares: t.shares,
  price: rupees(t.price_paise),
  amount: rupees(t.amount_paise),
  status: t.status,
  time: t.created_at,
});

/** A trade as the buyer or seller sees it. */
const myTrade = (t, userId) => ({
  ...marketTrade(t),
  side: t.buyer_id === userId ? "buy" : "sell",
  orderId: t.buyer_id === userId ? t.buy_order_id : t.sell_order_id,
  transaction: t.tx_hash,
  failureReason: t.failure_reason,
  settledAt: t.settled_at,
});

// ---------- Placing and cancelling orders ----------

/** Checks that the property can be traded right now and returns it. */
async function tradableProperty(propertyId, user) {
  const { rows } = await db.query(
    "SELECT p.*, u.wallet_address AS owner_wallet FROM properties p JOIN users u ON u.id = p.owner_id WHERE p.id = $1",
    [propertyId]
  );
  const p = rows[0];
  if (!p) throw new HttpError(404, "Property not found");
  const onChain = await chain.readProperty(p.contract_address, p.owner_wallet);
  if (onChain.status !== "approved") throw new HttpError(409, "This property is not approved for trading yet");
  if (onChain.frozen) throw new HttpError(409, `This property is frozen: ${onChain.freezeReason}`);
  if (!(await chain.isWhitelisted(p.contract_address, user.wallet_address))) {
    throw new HttpError(409, "Your wallet is not on this property's whitelist yet. Please contact support");
  }
  return p;
}

/**
 * Shares you can put up for sale: what your wallet holds on the chain,
 * minus shares already in open sell orders or in trades still settling.
 */
async function sellableShares(client, userId, walletAddress, property) {
  const onChain = await chain.balanceOf(property.contract_address, walletAddress);
  const { rows } = await client.query(
    `SELECT
       (SELECT COALESCE(SUM(shares - filled_shares), 0) FROM book_orders
         WHERE user_id = $1 AND property_id = $2 AND side = 'sell' AND status = 'open')
     + (SELECT COALESCE(SUM(shares), 0) FROM trades
         WHERE seller_id = $1 AND property_id = $2 AND status IN ('settling', 'failed')) AS held`,
    [userId, property.id]
  );
  return onChain - Number(rows[0].held);
}

/** Locks one property's order book until the end of the transaction. */
const lockBook = (client, propertyId) => client.query("SELECT id FROM properties WHERE id = $1 FOR UPDATE", [propertyId]);

/** The best waiting order on the other side that this order can trade with. */
async function bestMatch(client, order) {
  const buying = order.side === "buy";
  const { rows } = await client.query(
    `SELECT * FROM book_orders
     WHERE property_id = $1 AND side = $2 AND status = 'open'
       AND price_paise ${buying ? "<=" : ">="} $3
     ORDER BY price_paise ${buying ? "ASC" : "DESC"}, id ASC
     LIMIT 1`,
    [order.property_id, buying ? "sell" : "buy", order.price_paise]
  );
  return rows[0];
}

/** Adds `shares` to an order's filled count, and marks it filled when done. */
async function fill(client, orderId, shares) {
  const { rows } = await client.query(
    `UPDATE book_orders
     SET filled_shares = filled_shares + $2,
         status = CASE WHEN filled_shares + $2 = shares THEN 'filled' ELSE status END,
         updated_at = now()
     WHERE id = $1 RETURNING *`,
    [orderId, shares]
  );
  return rows[0];
}

/**
 * Puts a limit order on the book and matches it right away.
 * Returns { order, trades, touched } where touched = other orders that traded.
 */
async function placeOrder(user, { propertyId, side, shares, pricePaise }) {
  if (shares * pricePaise > MAX_ORDER_PAISE) throw new HttpError(400, "One order can be at most ₹1 crore");
  const property = await tradableProperty(propertyId, user);

  const result = await cash.inTransaction(async (client) => {
    await lockBook(client, property.id);

    // You can't trade with yourself.
    const { rows: own } = await client.query(
      `SELECT 1 FROM book_orders
       WHERE user_id = $1 AND property_id = $2 AND side = $3 AND status = 'open'
         AND price_paise ${side === "buy" ? "<=" : ">="} $4 LIMIT 1`,
      [user.id, property.id, side === "buy" ? "sell" : "buy", pricePaise]
    );
    if (own.length) throw new HttpError(409, "This order would trade with your own order. Cancel that one first");

    if (side === "buy") {
      await holdingLimit.check(client, user, property, shares);
      await cash.lockBalance(client, user.id);
      const available = await cash.availablePaise(client, user.id);
      if (shares * pricePaise > available) {
        throw new HttpError(409, `Not enough money in your wallet. You have ₹${(available / 100).toFixed(2)} available. Add money first`);
      }
    } else {
      const available = await sellableShares(client, user.id, user.wallet_address, property);
      if (shares > available) {
        throw new HttpError(409, available > 0 ? `You can sell at most ${available} shares` : "You have no shares of this property to sell");
      }
    }

    const { rows } = await client.query(
      `INSERT INTO book_orders (user_id, property_id, side, price_paise, shares)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [user.id, property.id, side, pricePaise, shares]
    );
    let order = rows[0];
    const trades = [];
    const touched = [];

    while (order.status === "open") {
      const other = await bestMatch(client, order);
      if (!other) break;
      const qty = Math.min(order.shares - order.filled_shares, other.shares - other.filled_shares);
      const price = Number(other.price_paise); // the waiting order's price
      const [buy, sell] = side === "buy" ? [order, other] : [other, order];
      const { rows: t } = await client.query(
        `INSERT INTO trades (property_id, buy_order_id, sell_order_id, buyer_id, seller_id, shares, price_paise, amount_paise)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [property.id, buy.id, sell.id, buy.user_id, sell.user_id, qty, price, qty * price]
      );
      trades.push(t[0]);
      touched.push(await fill(client, other.id, qty));
      order = await fill(client, order.id, qty);
    }
    return { order, trades, touched };
  });

  await announce(property.id, [result.order, ...result.touched], result.trades);
  result.trades.forEach((t) => settleInBackground(t.id));
  return result;
}

/** Cancels what's left of an open order. */
async function cancelOrder(user, orderId) {
  const { rows } = await db.query("SELECT * FROM book_orders WHERE id = $1", [orderId]);
  if (!rows[0] || rows[0].user_id !== user.id) throw new HttpError(404, "Order not found");
  const order = await cash.inTransaction(async (client) => {
    await lockBook(client, rows[0].property_id);
    const { rows: updated } = await client.query(
      "UPDATE book_orders SET status = 'cancelled', updated_at = now() WHERE id = $1 AND status = 'open' RETURNING *",
      [orderId]
    );
    if (!updated[0]) throw new HttpError(409, "Only open orders can be cancelled");
    return updated[0];
  });
  await announce(order.property_id, [order], []);
  return order;
}

// ---------- Settlement on the blockchain ----------

const inFlight = new Map(); // trade id -> promise

/** Moves the shares for one trade on the chain, then moves the money. */
function settleTrade(tradeId) {
  if (!inFlight.has(tradeId)) {
    inFlight.set(tradeId, doSettle(tradeId).finally(() => inFlight.delete(tradeId)));
  }
  return inFlight.get(tradeId);
}

/** Same, but doesn't wait. Errors are logged, never thrown. */
function settleInBackground(tradeId) {
  settleTrade(tradeId).catch((err) => console.error(`Trade ${tradeId}: settlement crashed`, err));
}

/** Resolves when no trade is settling in this server (used by tests). */
async function idle() {
  while (inFlight.size) await Promise.allSettled([...inFlight.values()]);
}

async function doSettle(tradeId) {
  const { rows } = await db.query(
    `SELECT t.*, p.contract_address, buyer.wallet_address AS buyer_wallet, seller.wallet_key_enc AS seller_key
     FROM trades t
     JOIN properties p ON p.id = t.property_id
     JOIN users buyer ON buyer.id = t.buyer_id
     JOIN users seller ON seller.id = t.seller_id
     WHERE t.id = $1`,
    [tradeId]
  );
  const t = rows[0];
  if (!t || t.status !== "settling") return;

  try {
    // Sent before (e.g. the server restarted while waiting)? Check it first,
    // so the shares never move twice.
    if (t.tx_hash) {
      const outcome = await chain.transactionOutcome(t.tx_hash);
      if (outcome === "success") return finish(t, t.tx_hash);
      if (outcome === "unknown") return fail(t, "The blockchain has not confirmed the transfer yet. Try again later");
    }
    const seller = chain.userSigner({ wallet_key_enc: t.seller_key });
    const hash = await chain.transferSharesTracked(t.contract_address, seller, t.buyer_wallet, t.shares, (h) =>
      db.query("UPDATE trades SET tx_hash = $2 WHERE id = $1", [t.id, h])
    );
    await finish(t, hash);
  } catch (err) {
    const reason = err.revert?.name
      ? `Blockchain refused: ${err.revert.name}`
      : err.code === "CALL_EXCEPTION" ? "Blockchain refused the transfer" : "Could not reach the blockchain";
    if (!err.revert?.name) console.error(`Trade ${t.id}: share transfer failed`, err);
    await fail(t, reason);
  }
}

/** The shares arrived: move the money from buyer to seller, in one step. */
async function finish(t, hash) {
  const settled = await cash.inTransaction(async (client) => {
    // Lock both wallets, lowest id first, so two trades can't block each other.
    for (const id of [t.buyer_id, t.seller_id].sort((a, b) => a - b)) await cash.lockBalance(client, id);
    const { rows } = await client.query(
      `UPDATE trades SET status = 'settled', tx_hash = $2, failure_reason = NULL, settled_at = now()
       WHERE id = $1 AND status = 'settling' RETURNING *`,
      [t.id, hash]
    );
    if (!rows[0]) return null;
    await cash.addEntry(client, t.buyer_id, "buy", -Number(t.amount_paise), { tradeId: t.id });
    await cash.addEntry(client, t.seller_id, "sell", Number(t.amount_paise), { tradeId: t.id });
    return rows[0];
  });
  if (settled) await announceTrade(settled, { wallets: true });
}

async function fail(t, reason) {
  const { rows } = await db.query(
    "UPDATE trades SET status = 'failed', failure_reason = $2 WHERE id = $1 AND status = 'settling' RETURNING *",
    [t.id, reason]
  );
  if (rows[0]) await announceTrade(rows[0], { wallets: false });
}

/** Tries a failed trade again (e.g. after the property is unfrozen). */
async function retryTrade(user, tradeId) {
  const { rows } = await db.query("SELECT * FROM trades WHERE id = $1", [tradeId]);
  const t = rows[0];
  if (!t || (user.role !== "admin" && t.buyer_id !== user.id && t.seller_id !== user.id)) {
    throw new HttpError(404, "Trade not found");
  }
  if (t.status !== "failed") throw new HttpError(409, `Only failed trades can be retried (this one is ${t.status})`);
  const { rowCount } = await db.query("UPDATE trades SET status = 'settling' WHERE id = $1 AND status = 'failed'", [t.id]);
  if (!rowCount) throw new HttpError(409, "This trade is already being processed");
  await settleTrade(t.id);
  return (await db.query("SELECT * FROM trades WHERE id = $1", [t.id])).rows[0];
}

/** After the Land Authority unfreezes a property: try its failed trades again. */
async function retryFailedTrades(propertyId) {
  const { rows } = await db.query(
    "UPDATE trades SET status = 'settling' WHERE property_id = $1 AND status = 'failed' RETURNING id",
    [propertyId]
  );
  rows.forEach((t) => settleInBackground(t.id));
  return rows.length;
}

/** Tells watchers that a property was frozen or unfrozen. */
async function announceStatus(propertyId) {
  try {
    live.toProperty(propertyId, "ticker", await ticker(propertyId));
  } catch (err) {
    console.error("Could not send live update", err);
  }
}

/** After a restart: finish every trade that was still settling. */
async function resumeSettlement() {
  const { rows } = await db.query("SELECT id FROM trades WHERE status = 'settling' ORDER BY id");
  rows.forEach((t) => settleInBackground(t.id));
  return rows.length;
}

// ---------- Market data ----------

/** Waiting orders grouped by price. Best prices first. */
async function orderBook(propertyId, depth = 20) {
  const side = async (name, dir) => {
    const { rows } = await db.query(
      `SELECT price_paise, SUM(shares - filled_shares)::int AS shares, COUNT(*)::int AS orders
       FROM book_orders WHERE property_id = $1 AND side = $2 AND status = 'open'
       GROUP BY price_paise ORDER BY price_paise ${dir} LIMIT $3`,
      [propertyId, name, depth]
    );
    return rows.map((r) => ({ price: rupees(r.price_paise), shares: r.shares, orders: r.orders }));
  };
  const [bids, asks] = await Promise.all([side("buy", "DESC"), side("sell", "ASC")]);
  return { propertyId: Number(propertyId), bids, asks };
}

/** Price, 24h change, volume and market cap, like the top of a stock page. */
async function ticker(propertyId) {
  const { rows } = await db.query(
    `SELECT p.id, p.name, p.symbol, p.total_shares, p.price_per_share, p.frozen, p.max_holding_percent,
       (SELECT price_paise FROM trades WHERE property_id = p.id AND status <> 'failed'
         ORDER BY id DESC LIMIT 1) AS last_paise,
       (SELECT price_paise FROM trades WHERE property_id = p.id AND status <> 'failed'
         AND created_at <= now() - interval '24 hours' ORDER BY id DESC LIMIT 1) AS prev_paise,
       (SELECT MAX(price_paise) FROM trades WHERE property_id = p.id AND status <> 'failed'
         AND created_at > now() - interval '24 hours') AS high_paise,
       (SELECT MIN(price_paise) FROM trades WHERE property_id = p.id AND status <> 'failed'
         AND created_at > now() - interval '24 hours') AS low_paise,
       (SELECT COALESCE(SUM(shares), 0)::int FROM trades WHERE property_id = p.id AND status <> 'failed'
         AND created_at > now() - interval '24 hours') AS volume,
       (SELECT COALESCE(SUM(amount_paise), 0) FROM trades WHERE property_id = p.id AND status <> 'failed'
         AND created_at > now() - interval '24 hours') AS turnover_paise,
       (SELECT MAX(price_paise) FROM book_orders WHERE property_id = p.id AND side = 'buy' AND status = 'open') AS bid_paise,
       (SELECT MIN(price_paise) FROM book_orders WHERE property_id = p.id AND side = 'sell' AND status = 'open') AS ask_paise,
       (SELECT COALESCE(SUM(shares - filled_shares), 0)::int FROM book_orders
         WHERE property_id = p.id AND side = 'sell' AND status = 'open') AS for_sale
     FROM properties p WHERE p.id = $1`,
    [propertyId]
  );
  const r = rows[0];
  if (!r) throw new HttpError(404, "Property not found");
  const limit = await holdingLimit.limitFor(r);
  // No trades yet? Use the listing price.
  const listing = Math.round(Number(r.price_per_share) * 100);
  const last = r.last_paise ? Number(r.last_paise) : listing;
  const prev = r.prev_paise ? Number(r.prev_paise) : listing;
  const optional = (paise) => (paise === null ? null : rupees(paise));
  return {
    propertyId: r.id,
    name: r.name,
    symbol: r.symbol,
    frozen: r.frozen,
    lastPrice: rupees(last),
    change24h: rupees(last - prev),
    changePercent24h: Math.round(((last - prev) / prev) * 10000) / 100,
    high24h: optional(r.high_paise),
    low24h: optional(r.low_paise),
    volume24h: r.volume, // shares
    turnover24h: rupees(r.turnover_paise), // rupees
    marketCap: rupees(last * r.total_shares),
    bestBid: optional(r.bid_paise),
    bestAsk: optional(r.ask_paise),
    sharesForSale: r.for_sale, // shares other investors are selling right now
    maxHolding: { percent: limit.percent, shares: limit.maxShares }, // the most one investor may own
  };
}

const INTERVALS = { "1m": "1 minute", "5m": "5 minutes", "15m": "15 minutes", "1h": "1 hour", "1d": "1 day" };

/**
 * OHLC candles for a price chart: for each time slot, the first (open),
 * highest, lowest and last (close) price, and the shares traded (volume).
 * `time` is in Unix seconds, the format TradingView Lightweight Charts uses.
 */
async function candles(propertyId, interval = "1h", limit = 200) {
  const { rows } = await db.query(
    `SELECT extract(epoch FROM date_bin($2::interval, created_at, TIMESTAMPTZ '2000-01-01'))::bigint AS time,
            (array_agg(price_paise ORDER BY id))[1] AS open,
            MAX(price_paise) AS high,
            MIN(price_paise) AS low,
            (array_agg(price_paise ORDER BY id DESC))[1] AS close,
            SUM(shares)::int AS volume
     FROM trades WHERE property_id = $1 AND status <> 'failed'
     GROUP BY 1 ORDER BY 1 DESC LIMIT $3`,
    [propertyId, INTERVALS[interval], limit]
  );
  return rows.reverse().map((c) => ({
    time: Number(c.time),
    open: rupees(c.open),
    high: rupees(c.high),
    low: rupees(c.low),
    close: rupees(c.close),
    volume: c.volume,
  }));
}

async function recentTrades(propertyId, limit = 50) {
  const { rows } = await db.query(
    "SELECT * FROM trades WHERE property_id = $1 AND status <> 'failed' ORDER BY id DESC LIMIT $2",
    [propertyId, limit]
  );
  return rows.map(marketTrade);
}

/** The last traded price of each property (listing price if none), in rupees. */
async function lastPrices() {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (property_id) property_id, price_paise FROM trades
     WHERE status <> 'failed' ORDER BY property_id, id DESC`
  );
  return new Map(rows.map((r) => [r.property_id, rupees(r.price_paise)]));
}

// ---------- Live updates ----------

/** Tells watchers about a changed book and new trades, and each owner about their orders. */
async function announce(propertyId, orders, trades) {
  try {
    live.toProperty(propertyId, "orderbook", await orderBook(propertyId));
    for (const t of trades) {
      live.toProperty(propertyId, "trade", marketTrade(t));
      live.toUser(t.buyer_id, "trade", myTrade(t, t.buyer_id));
      live.toUser(t.seller_id, "trade", myTrade(t, t.seller_id));
    }
    live.toProperty(propertyId, "ticker", await ticker(propertyId)); // best bid/ask and shares for sale change too
    for (const o of orders) live.toUser(o.user_id, "order", publicOrder(o));
    const buyers = new Set(orders.filter((o) => o.side === "buy").map((o) => o.user_id));
    for (const id of buyers) live.toUser(id, "wallet", await cash.summary(id));
  } catch (err) {
    console.error("Could not send live update", err);
  }
}

async function announceTrade(t, { wallets }) {
  try {
    live.toProperty(t.property_id, "trade", marketTrade(t));
    live.toUser(t.buyer_id, "trade", myTrade(t, t.buyer_id));
    live.toUser(t.seller_id, "trade", myTrade(t, t.seller_id));
    if (wallets) {
      live.toUser(t.buyer_id, "wallet", await cash.summary(t.buyer_id));
      live.toUser(t.seller_id, "wallet", await cash.summary(t.seller_id));
    }
  } catch (err) {
    console.error("Could not send live update", err);
  }
}

module.exports = {
  INTERVALS, MAX_PRICE_PAISE, publicOrder, marketTrade, myTrade,
  placeOrder, cancelOrder, sellableShares,
  settleTrade, retryTrade, retryFailedTrades, resumeSettlement, idle, announceStatus,
  orderBook, ticker, candles, recentTrades, lastPrices,
};
