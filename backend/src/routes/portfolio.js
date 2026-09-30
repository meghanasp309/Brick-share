// Your shares and your history. Share counts are read from the blockchain,
// which is the real record of who owns what. The database only adds
// what you paid (from your orders and trades) and the market price.
const express = require("express");
const db = require("../db");
const chain = require("../chain");
const trading = require("../trading");
const { requireAuth } = require("../auth");

const router = express.Router();
const ZERO = "0x0000000000000000000000000000000000000000";
const rupees = (n) => Math.round(n * 100) / 100;

// What you own right now, and what it's worth at the market price
// (the last trade on the order book, or the listing price if there's none).
// "invested" = what you paid for shares minus what you got for selling them.
// "rentEarned" = rent paid into your wallet for this property.
router.get("/portfolio", requireAuth, async (req, res) => {
  const wallet = req.user.wallet_address;
  const { rows: props } = await db.query(
    `SELECT p.*,
       (SELECT COALESCE(SUM(amount_paise), 0) FROM orders
         WHERE property_id = p.id AND user_id = $1 AND status = 'completed')
     + (SELECT COALESCE(SUM(CASE WHEN buyer_id = $1 THEN amount_paise ELSE -amount_paise END), 0) FROM trades
         WHERE property_id = p.id AND status = 'settled' AND (buyer_id = $1 OR seller_id = $1)) AS invested_paise,
       (SELECT COALESCE(SUM(e.amount_paise), 0) FROM cash_entries e
         JOIN rent_payouts r ON r.id = e.rent_payout_id
         WHERE e.user_id = $1 AND e.kind = 'rent' AND r.property_id = p.id) AS rent_paise
     FROM properties p
     WHERE p.status = 'approved'
     ORDER BY p.id`,
    [req.user.id]
  );
  const [balances, prices] = await Promise.all([
    Promise.all(props.map((p) => chain.balanceOf(p.contract_address, wallet))),
    trading.lastPrices(),
  ]);

  const holdings = props
    .map((p, i) => {
      const shares = balances[i];
      const price = prices.get(p.id) ?? Number(p.price_per_share);
      return {
        property: { id: p.id, ref: p.ref, name: p.name, symbol: p.symbol, location: p.location, frozen: p.frozen },
        shares,
        ownership: rupees((shares / p.total_shares) * 100), // percent of the property
        pricePerShare: price,
        value: rupees(shares * price),
        invested: Number(p.invested_paise) / 100,
        rentEarned: Number(p.rent_paise) / 100, // all rent received for this property
      };
    })
    .filter((h) => h.shares > 0);

  const totalValue = rupees(holdings.reduce((sum, h) => sum + h.value, 0));
  const totalInvested = rupees(holdings.reduce((sum, h) => sum + h.invested, 0));
  const { rows: rentRows } = await db.query(
    "SELECT COALESCE(SUM(amount_paise), 0) AS paise FROM cash_entries WHERE user_id = $1 AND kind = 'rent'",
    [req.user.id]
  );
  res.json({
    walletAddress: wallet,
    holdings,
    // rentEarned counts all rent ever received, also from properties you have since sold.
    totals: { properties: holdings.length, value: totalValue, invested: totalInvested, rentEarned: Number(rentRows[0].paise) / 100 },
  });
});

// Every share movement in or out of your wallet, newest first.
router.get("/transactions", requireAuth, async (req, res) => {
  const wallet = req.user.wallet_address;
  const { rows: props } = await db.query("SELECT * FROM properties WHERE status = 'approved' ORDER BY id");
  const { rows: orders } = await db.query(
    // Your purchases, and (if you are an owner) the shares you sold.
    `SELECT o.id, o.tx_hash, o.amount_paise FROM orders o JOIN properties p ON p.id = o.property_id
     WHERE o.tx_hash IS NOT NULL AND (o.user_id = $1 OR p.owner_id = $1)`,
    [req.user.id]
  );
  const orderByTx = new Map(orders.map((o) => [o.tx_hash.toLowerCase(), o]));
  // Your trades with other investors on the order book.
  const { rows: trades } = await db.query(
    "SELECT id, tx_hash, amount_paise FROM trades WHERE tx_hash IS NOT NULL AND (buyer_id = $1 OR seller_id = $1)",
    [req.user.id]
  );
  const tradeByTx = new Map(trades.map((t) => [t.tx_hash.toLowerCase(), t]));

  const perProperty = await Promise.all(props.map((p) => chain.transfersOf(p.contract_address, wallet, p.deploy_block ?? 0)));
  const transactions = perProperty.flatMap((events, i) => {
    const p = props[i];
    return events.map((e) => {
      const incoming = e.to.toLowerCase() === wallet.toLowerCase();
      const order = orderByTx.get(e.txHash.toLowerCase());
      const trade = tradeByTx.get(e.txHash.toLowerCase());
      let type = incoming ? "received" : "sent";
      if (e.from === ZERO) type = "issued"; // the owner got all shares when the property was approved
      else if (order || trade) type = incoming ? "buy" : "sell";
      return {
        type,
        property: { id: p.id, name: p.name, symbol: p.symbol },
        shares: e.shares,
        from: e.from,
        to: e.to,
        amount: order || trade ? Number((order || trade).amount_paise) / 100 : null,
        orderId: order?.id ?? null,
        tradeId: trade?.id ?? null,
        transaction: e.txHash,
        blockNumber: e.blockNumber,
        timestamp: e.timestamp,
      };
    });
  });
  transactions.sort((a, b) => b.blockNumber - a.blockNumber);
  res.json({ transactions });
});

module.exports = router;
