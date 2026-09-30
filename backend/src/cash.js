// The in-app rupee wallet (test money only).
//
//  balance   = all money in (deposits, sales, rent) minus all money out
//  held      = money promised to open buy orders and to trades that are
//              still moving on the chain
//  available = balance - held   (what you can spend or withdraw now)
//
// Amounts are in paise (1 rupee = 100 paise).
const db = require("./db");

/** Makes sure the user has a wallet row. */
const ensureAccount = (client, userId) =>
  client.query("INSERT INTO cash_accounts (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [userId]);

/**
 * Locks the user's wallet row until the end of the database transaction,
 * so two requests can't spend the same money at once. Returns the balance.
 */
async function lockBalance(client, userId) {
  await ensureAccount(client, userId);
  const { rows } = await client.query("SELECT balance_paise FROM cash_accounts WHERE user_id = $1 FOR UPDATE", [userId]);
  return Number(rows[0].balance_paise);
}

async function heldPaise(client, userId) {
  const { rows } = await client.query(
    `SELECT
       (SELECT COALESCE(SUM((shares - filled_shares) * price_paise), 0) FROM book_orders
         WHERE user_id = $1 AND side = 'buy' AND status = 'open')
     + (SELECT COALESCE(SUM(amount_paise), 0) FROM trades
         WHERE buyer_id = $1 AND status IN ('settling', 'failed')) AS held`,
    [userId]
  );
  return Number(rows[0].held);
}

/** Money you can spend right now. Call lockBalance first inside a transaction. */
async function availablePaise(client, userId) {
  const { rows } = await client.query("SELECT balance_paise FROM cash_accounts WHERE user_id = $1", [userId]);
  return Number(rows[0]?.balance_paise || 0) - (await heldPaise(client, userId));
}

/** Adds (+) or removes (-) money and records why. Needs the row locked. */
async function addEntry(client, userId, kind, amountPaise, { depositId = null, tradeId = null, rentPayoutId = null } = {}) {
  await client.query(
    `INSERT INTO cash_entries (user_id, kind, amount_paise, deposit_id, trade_id, rent_payout_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, kind, amountPaise, depositId, tradeId, rentPayoutId]
  );
  await client.query("UPDATE cash_accounts SET balance_paise = balance_paise + $2 WHERE user_id = $1", [userId, amountPaise]);
}

/** The wallet as the app sees it, in rupees. */
async function summary(userId, client = db) {
  const { rows } = await client.query("SELECT balance_paise FROM cash_accounts WHERE user_id = $1", [userId]);
  const balance = Number(rows[0]?.balance_paise || 0);
  const held = await heldPaise(client, userId);
  return { balance: balance / 100, held: held / 100, available: (balance - held) / 100, currency: "INR" };
}

/** Runs `fn(client)` inside one database transaction. */
async function inTransaction(fn) {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { lockBalance, availablePaise, addEntry, summary, inTransaction };
