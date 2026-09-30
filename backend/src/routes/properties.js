// Property listings. Each property is its own PropertyToken contract.
//
//  1. An owner (with approved KYC) lists a property -> the contract is deployed (Pending).
//  2. The Land Authority checks the papers and approves it -> all shares go to the owner.
//  3. The Land Authority can freeze / unfreeze it if there is a legal dispute.
const crypto = require("crypto");
const fs = require("fs");
const express = require("express");
const db = require("../db");
const chain = require("../chain");
const { HttpError } = require("../errors");
const { requireAuth, requireRole, requireKyc } = require("../auth");
const { uploader, fileHash } = require("../uploads");
const v = require("../validate");
const { reservedShares } = require("./orders");
const trading = require("../trading");

const router = express.Router();
const upload = uploader("papers");

const publicProperty = (p) => ({
  id: p.id,
  ref: p.ref,
  name: p.name,
  symbol: p.symbol,
  location: p.location,
  description: p.description,
  totalShares: p.total_shares,
  pricePerShare: Number(p.price_per_share),
  documentHash: p.document_hash,
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
  return rows[0];
}

// Anyone can browse. Optional filter: ?status=pending or ?status=approved
router.get("/properties", async (req, res) => {
  const where = [];
  const params = [];
  if (req.query.status) {
    params.push(req.query.status);
    where.push(`p.status = $${params.length}`);
  }
  const { rows } = await db.query(
    `${SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY p.id DESC`,
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
// and an optional file called "papers" (sale deed etc.).
router.post(
  "/properties",
  requireAuth, requireRole("owner"), requireKyc, upload.single("papers"),
  async (req, res) => {
    try {
      const name = v.text(req.body, "name", { max: 100 });
      const symbol = v.text(req.body, "symbol", { max: 10 }).toUpperCase();
      if (!/^[A-Z0-9]{2,10}$/.test(symbol)) throw new HttpError(400, "symbol must be 2-10 letters or digits");
      const location = v.text(req.body, "location", { max: 200 });
      const description = v.text(req.body, "description", { max: 2000, optional: true });
      const totalShares = v.positive(req.body, "totalShares", { integer: true, max: 1_000_000_000 });
      const pricePerShare = v.positive(req.body, "pricePerShare", { max: 1e9 });

      // Fingerprint of the papers. (Phase 4 moves the file itself to IPFS.)
      const documentHash = req.file ? fileHash(req.file.path) : "none";
      const ref = "BS-" + crypto.randomBytes(4).toString("hex").toUpperCase();
      const { rows: la } = await db.query("SELECT wallet_address FROM users WHERE role = 'land_authority' LIMIT 1");
      if (!la[0]) throw new HttpError(500, "No Land Authority account exists");

      const contractAddress = await chain.deployProperty({
        name, symbol, propertyId: ref, documentHash, totalShares,
        owner: req.user.wallet_address, landAuthority: la[0].wallet_address,
      });

      const { rows } = await db.query(
        `INSERT INTO properties (ref, owner_id, name, symbol, location, description, total_shares,
                                 price_per_share, document_hash, document_path, contract_address)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [ref, req.user.id, name, symbol, location, description, totalShares,
         pricePerShare, documentHash, req.file?.path || null, contractAddress]
      );

      // Every investor who already passed KYC may hold shares of this property too.
      const { rows: verified } = await db.query(
        "SELECT wallet_address FROM users WHERE kyc_status = 'approved' AND id <> $1",
        [req.user.id]
      );
      for (const u of verified) await chain.addToWhitelist(contractAddress, u.wallet_address);

      res.status(201).json({ property: publicProperty(await findProperty(rows[0].id)) });
    } catch (err) {
      if (req.file && err instanceof HttpError) fs.rmSync(req.file.path, { force: true });
      throw err;
    }
  }
);

// ---------- Land Authority ----------

const la = [requireAuth, requireRole("land_authority")];

router.post("/properties/:id/approve", ...la, async (req, res) => {
  const p = await findProperty(req.params.id);
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
  // Trades that failed because of the freeze can now go through.
  await trading.retryFailedTrades(p.id);
  res.json({ property: publicProperty(await findProperty(p.id)), transaction: tx });
});

module.exports = router;
