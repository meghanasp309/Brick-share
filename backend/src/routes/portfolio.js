// Your shares and your history. Share counts are read from the blockchain,
// which is the real record of who owns what. The database only adds
// what you paid (from your orders).
const express = require("express");
const db = require("../db");
const chain = require("../chain");
const { requireAuth } = require("../auth");

const router = express.Router();
const ZERO = "0x0000000000000000000000000000000000000000";
const rupees = (n) => Math.round(n * 100) / 100;

// What you own right now, and what it's worth at today's price.
router.get("/portfolio", requireAuth, async (req, res) => {
  const wallet = req.user.wallet_address;
  const { rows: props } = await db.query(
    `SELECT p.*,
            COALESCE(SUM(o.amount_paise) FILTER (WHERE o.status = 'completed'), 0)::bigint AS invested_paise
     FROM properties p
     LEFT JOIN orders o ON o.property_id = p.id AND o.user_id = $1
     WHERE p.status = 'approved'
     GROUP BY p.id ORDER BY p.id`,
    [req.user.id]
  );
  const balances = await Promise.all(props.map((p) => chain.balanceOf(p.contract_address, wallet)));

  const holdings = props
    .map((p, i) => {
      const shares = balances[i];
      const price = Number(p.price_per_share);
      return {
        property: { id: p.id, ref: p.ref, name: p.name, symbol: p.symbol, location: p.location, frozen: p.frozen },
        shares,
        ownership: rupees((shares / p.total_shares) * 100), // percent of the property
        pricePerShare: price,
        value: rupees(shares * price),
        invested: Number(p.invested_paise) / 100,
      };
    })
    .filter((h) => h.shares > 0);

  const totalValue = rupees(holdings.reduce((sum, h) => sum + h.value, 0));
  const totalInvested = rupees(holdings.reduce((sum, h) => sum + h.invested, 0));
  res.json({
    walletAddress: wallet,
    holdings,
    totals: { properties: holdings.length, value: totalValue, invested: totalInvested },
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

  const perProperty = await Promise.all(props.map((p) => chain.transfersOf(p.contract_address, wallet)));
  const transactions = perProperty.flatMap((events, i) => {
    const p = props[i];
    return events.map((e) => {
      const incoming = e.to.toLowerCase() === wallet.toLowerCase();
      const order = orderByTx.get(e.txHash.toLowerCase());
      let type = incoming ? "received" : "sent";
      if (e.from === ZERO) type = "issued"; // the owner got all shares when the property was approved
      else if (order) type = incoming ? "buy" : "sell";
      return {
        type,
        property: { id: p.id, name: p.name, symbol: p.symbol },
        shares: e.shares,
        from: e.from,
        to: e.to,
        amount: order ? Number(order.amount_paise) / 100 : null,
        orderId: order?.id ?? null,
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
