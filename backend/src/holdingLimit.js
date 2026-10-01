// Max % per investor: the most one investor may own of a property.
//
// The admin sets one limit for the whole platform (e.g. 25%). An owner can
// pick a lower limit for their own property, never a higher one. The owner's
// own unsold shares don't count: only investors are limited.
//
// Checked on every buy (from the owner and on the market). It counts shares
// you already hold plus shares you are about to get (unpaid or unsettled
// orders, and open buy orders on the market).
const db = require("./db");
const chain = require("./chain");
const { HttpError } = require("./errors");

/** The admin's limit for the whole platform, in %. */
async function platformPercent(client = db) {
  const { rows } = await client.query("SELECT max_holding_percent FROM platform_settings WHERE id = 1");
  return rows[0] ? Number(rows[0].max_holding_percent) : 25;
}

async function setPlatformPercent(percent) {
  await db.query(
    `INSERT INTO platform_settings (id, max_holding_percent, updated_at) VALUES (1, $1, now())
     ON CONFLICT (id) DO UPDATE SET max_holding_percent = $1, updated_at = now()`,
    [percent]
  );
}

/**
 * The limit for one property (a properties row).
 * percent = the lower of the admin's and the owner's; maxShares = that many shares.
 */
async function limitFor(property, client = db) {
  const platform = await platformPercent(client);
  const owner = property.max_holding_percent === null || property.max_holding_percent === undefined
    ? null
    : Number(property.max_holding_percent);
  const percent = owner === null ? platform : Math.min(owner, platform);
  return {
    percent,
    platformPercent: platform,
    ownerPercent: owner,
    maxShares: Math.floor((property.total_shares * percent) / 100),
  };
}

/** Shares this investor holds, or will get once their orders go through. */
async function heldAndComing(client, userId, walletAddress, property) {
  const onChain = await chain.balanceOf(property.contract_address, walletAddress);
  const { rows } = await client.query(
    `SELECT
       (SELECT COALESCE(SUM(shares), 0) FROM orders
         WHERE user_id = $1 AND property_id = $2
           AND (status IN ('paid', 'failed') OR (status = 'created' AND expires_at > now())))
     + (SELECT COALESCE(SUM(shares), 0) FROM trades
         WHERE buyer_id = $1 AND property_id = $2 AND status IN ('settling', 'failed'))
     + (SELECT COALESCE(SUM(shares - filled_shares), 0) FROM book_orders
         WHERE user_id = $1 AND property_id = $2 AND side = 'buy' AND status = 'open') AS coming`,
    [userId, property.id]
  );
  return onChain + Number(rows[0].coming);
}

/**
 * Throws a 409 if buying `shares` more would take this investor over the limit.
 * Call it inside the transaction that locks the property, so two buys can't both slip through.
 */
async function check(client, user, property, shares) {
  const limit = await limitFor(property, client);
  const have = await heldAndComing(client, user.id, user.wallet_address, property);
  if (have + shares <= limit.maxShares) return;
  const rule = `One investor can own at most ${limit.percent}% of this property (${limit.maxShares} shares)`;
  const left = limit.maxShares - have;
  if (left <= 0) {
    throw new HttpError(409, `${rule}. You already have ${have} shares (counting open orders), so you can't buy more`);
  }
  throw new HttpError(409, `${rule}. You have ${have} (counting open orders), so you can buy at most ${left} more`);
}

module.exports = { platformPercent, setPlatformPercent, limitFor, heldAndComing, check };
