// Property listings. Each property is its own PropertyToken contract.
//
//  1. An owner (with approved KYC) lists a property -> the contract is deployed (Pending).
//  2. The Land Authority checks the papers and approves it -> all shares go to the owner.
//  3. The Land Authority can freeze / unfreeze it if there is a legal dispute,
//     even before approving it. A frozen property can't be approved.
//  4. The owner (or an admin) can delete it while no investor holds shares.
//     It disappears from the app, but its contract stays on the blockchain.
const crypto = require("crypto");
const express = require("express");
const db = require("../db");
const chain = require("../chain");
const { HttpError } = require("../errors");
const cash = require("../cash");
const { requireAuth, requireRole, requireKyc } = require("../auth");
const { memoryUploader } = require("../uploads");
const ipfs = require("../ipfs");
const { saveListingPapers } = require("./documents");
const v = require("../validate");
const { reservedShares, retryFailedOrders } = require("./orders");
const trading = require("../trading");
const rent = require("../rent");

const router = express.Router();
const upload = memoryUploader();

const publicProperty = (p) => ({
  id: p.id,
  ref: p.ref,
  name: p.name,
  symbol: p.symbol,
  location: p.location,
  description: p.description,
  totalShares: p.total_shares,
  pricePerShare: Number(p.price_per_share),
  documentHash: p.document_hash, // "ipfs://<CID>" of the listing papers, also in the contract
  contractAddress: p.contract_address,
  status: p.status,
  frozen: p.frozen,
  freezeReason: p.freeze_reason,
  owner: { id: p.owner_id, fullName: p.owner_name },
  approvedAt: p.approved_at,
  createdAt: p.created_at,
});

const SELECT = `SELECT p.*, u.full_name AS owner_name, u.wallet_address AS owner_wallet
                FROM properties p JOIN users u ON u.id = p.owner_id`;

async function findProperty(id) {
  const { rows } = await db.query(`${SELECT} WHERE p.id = $1`, [id]);
  if (!rows[0]) throw new HttpError(404, "Property not found");
  if (rows[0].deleted_at) throw new HttpError(404, "This property was removed by its owner");
  return rows[0];
}

// Anyone can browse. Optional filter: ?status=pending or ?status=approved
router.get("/properties", async (req, res) => {
  const where = ["p.deleted_at IS NULL"];
  const params = [];
  if (req.query.status) {
    params.push(req.query.status);
    where.push(`p.status = $${params.length}`);
  }
  const { rows } = await db.query(
    `${SELECT} WHERE ${where.join(" AND ")} ORDER BY p.id DESC`,
    params
  );
  res.json({ properties: rows.map(publicProperty) });
});

// One property, with its live state read straight from the blockchain.
router.get("/properties/:id", async (req, res) => {
  const p = await findProperty(req.params.id);
  const onChain = await chain.readProperty(p.contract_address, p.owner_wallet);
  // Shares investors can still buy: the owner's shares minus those held for open orders.
  const sharesForSale = Math.max(0, onChain.ownerShares - (await reservedShares(p.id)));
  res.json({ property: publicProperty(p), onChain, sharesForSale });
});

// Form fields: name, symbol, location, description, totalShares, pricePerShare,
// and an optional file called "papers" (sale deed etc.). The papers go to IPFS,
// and their CID is saved in the new contract as its documentHash.
router.post(
  "/properties",
  requireAuth, requireRole("owner"), requireKyc, upload.single("papers"),
  async (req, res) => {
    const name = v.text(req.body, "name", { max: 100 });
    const symbol = v.text(req.body, "symbol", { max: 10 }).toUpperCase();
    if (!/^[A-Z0-9]{2,10}$/.test(symbol)) throw new HttpError(400, "symbol must be 2-10 letters or digits");
    const location = v.text(req.body, "location", { max: 200 });
    const description = v.text(req.body, "description", { max: 2000, optional: true });
    const totalShares = v.positive(req.body, "totalShares", { integer: true, max: 1_000_000_000 });
    const pricePerShare = v.positive(req.body, "pricePerShare", { max: 1e9 });

    // The papers go to IPFS. Their CID (fingerprint) is saved in the contract.
    const papersCid = req.file ? await ipfs.add(req.file.buffer, req.file.originalname) : null;
    const documentHash = papersCid ? `ipfs://${papersCid}` : "none";
    const ref = "BS-" + crypto.randomBytes(4).toString("hex").toUpperCase();
    const { rows: la } = await db.query("SELECT wallet_address FROM users WHERE role = 'land_authority' LIMIT 1");
    if (!la[0]) throw new HttpError(500, "No Land Authority account exists");

    const deployed = await chain.deployProperty({
      name, symbol, propertyId: ref, documentHash, totalShares,
      owner: req.user.wallet_address, landAuthority: la[0].wallet_address,
    });

    const { rows } = await db.query(
      `INSERT INTO properties (ref, owner_id, name, symbol, location, description, total_shares,
                               price_per_share, document_hash, contract_address, deploy_block)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [ref, req.user.id, name, symbol, location, description, totalShares,
       pricePerShare, documentHash, deployed.address, deployed.block]
    );
    if (papersCid) await saveListingPapers(rows[0].id, req.file, papersCid, req.user.id);

    // Every investor who already passed KYC may hold shares of this property too.
    const { rows: verified } = await db.query(
      "SELECT wallet_address FROM users WHERE kyc_status = 'approved' AND id <> $1",
      [req.user.id]
    );
    for (const u of verified) await chain.addToWhitelist(deployed.address, u.wallet_address);

    res.status(201).json({ property: publicProperty(await findProperty(rows[0].id)) });
  }
);

// ---------- Deleting ----------

/**
 * Why this property can't be deleted right now, or null if it can.
 * Investors' money comes first: once anyone else holds shares, it stays.
 */
async function whyNotDeletable(client, p) {
  if (p.frozen) {
    return `The Land Authority froze this property (${p.freeze_reason}). It can't be deleted while it is frozen`;
  }
  if (p.status !== "approved") return null; // still pending: no shares exist yet

  const onChain = await chain.readProperty(p.contract_address, p.owner_wallet);
  const held = onChain.sharesIssued - onChain.ownerShares;
  if (held > 0) {
    return `Investors hold ${held} of its shares. A property can only be deleted while you hold all the shares`;
  }
  if ((await reservedShares(p.id, client)) > 0) {
    return "Someone is buying shares of this property right now. Try again in a few minutes";
  }
  const { rows } = await client.query(
    `SELECT
       (SELECT COUNT(*) FROM trades WHERE property_id = $1 AND status IN ('settling', 'failed'))::int AS trades,
       (SELECT COUNT(*) FROM rent_payouts WHERE property_id = $1 AND status = 'paid')::int AS rent`,
    [p.id]
  );
  if (rows[0].trades > 0) return "A trade of this property is still being completed. Try again later";
  if (rows[0].rent > 0) return "Rent for this property is still being shared out. Try again later";
  return null;
}

// Owners can delete their own property; admins can delete any.
// Open buy orders are cancelled (the money goes back to the buyers) and monthly rent stops.
router.delete("/properties/:id", requireAuth, requireRole("owner", "admin"), async (req, res) => {
  const p = await findProperty(req.params.id);
  if (req.user.role === "owner" && p.owner_id !== req.user.id) throw new HttpError(404, "Property not found");

  const cancelled = await cash.inTransaction(async (client) => {
    // Lock the property so nobody can buy it while we check.
    const { rows } = await client.query(`${SELECT} WHERE p.id = $1 FOR UPDATE OF p`, [p.id]);
    const locked = rows[0];
    if (locked.deleted_at) throw new HttpError(404, "This property was removed by its owner");
    const reason = await whyNotDeletable(client, locked);
    if (reason) throw new HttpError(409, reason);

    const orders = await trading.cancelPropertyOrders(client, p.id);
    await client.query("UPDATE rent_schedules SET active = false, updated_at = now() WHERE property_id = $1", [p.id]);
    await client.query("UPDATE properties SET deleted_at = now(), deleted_by = $2 WHERE id = $1", [p.id, req.user.id]);
    return orders;
  });
  await trading.announceCancelled(p.id, cancelled);

  res.json({
    deleted: true,
    cancelledOrders: cancelled.length,
    message: "Property deleted. It is hidden from the app. Its record on the blockchain stays, because nothing there can be erased.",
  });
});

// ---------- Land Authority ----------

const la = [requireAuth, requireRole("land_authority")];

router.post("/properties/:id/approve", ...la, async (req, res) => {
  const p = await findProperty(req.params.id);
  // The contract refuses too; this just gives a clearer message.
  if (p.frozen) throw new HttpError(409, `This property is frozen (${p.freeze_reason}). Unfreeze it before approving`);
  const tx = await chain.approveProperty(p.contract_address, chain.userSigner(req.user));
  await db.query("UPDATE properties SET status = 'approved', approved_at = now() WHERE id = $1", [p.id]);
  res.json({ property: publicProperty(await findProperty(p.id)), transaction: tx });
});

router.post("/properties/:id/freeze", ...la, async (req, res) => {
  const p = await findProperty(req.params.id);
  const reason = v.text(req.body || {}, "reason", { max: 200 });
  const tx = await chain.freeze(p.contract_address, chain.userSigner(req.user), reason);
  await db.query("UPDATE properties SET frozen = true, freeze_reason = $2 WHERE id = $1", [p.id, reason]);
  await trading.announceStatus(p.id);
  res.json({ property: publicProperty(await findProperty(p.id)), transaction: tx });
});

router.post("/properties/:id/unfreeze", ...la, async (req, res) => {
  const p = await findProperty(req.params.id);
  const tx = await chain.unfreeze(p.contract_address, chain.userSigner(req.user));
  await db.query("UPDATE properties SET frozen = false, freeze_reason = NULL WHERE id = $1", [p.id]);
  await trading.announceStatus(p.id);
  // Orders and trades that failed because of the freeze can now go through,
  // and rent that waited is shared out.
  await retryFailedOrders(p.id);
  await trading.retryFailedTrades(p.id);
  await rent.retryWaiting(p.id);
  res.json({ property: publicProperty(await findProperty(p.id)), transaction: tx });
});

module.exports = router;
