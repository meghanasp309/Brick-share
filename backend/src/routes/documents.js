// Property papers on IPFS. The file lives on IPFS; its CID (fingerprint) is
// saved in the property's smart contract. When you list the documents, the
// server checks each CID against the chain and says if it matches ("verified").
//
// Only property papers go to IPFS. Files there are public, so ID cards from
// KYC are never put on IPFS.
const express = require("express");
const db = require("../db");
const chain = require("../chain");
const ipfs = require("../ipfs");
const { HttpError } = require("../errors");
const { requireAuth, requireRole } = require("../auth");
const { memoryUploader } = require("../uploads");
const v = require("../validate");

const router = express.Router();
const upload = memoryUploader();

const KINDS = ["sale-deed", "title-report", "tax-receipt", "rent-agreement", "valuation", "photo", "other"];

const publicDocument = (d, verified) => ({
  id: d.id,
  kind: d.kind,
  cid: d.cid,
  fileName: d.file_name,
  mimeType: d.mime_type,
  size: d.size_bytes,
  url: `/properties/${d.property_id}/documents/${d.id}/file`,
  ipfsUrl: ipfs.gatewayUrl(d.cid),
  // Is the same CID saved in the property's smart contract?
  verified,
  transaction: d.tx_hash,
  createdAt: d.created_at,
});

async function findProperty(id) {
  const { rows } = await db.query("SELECT * FROM properties WHERE id = $1", [id]);
  if (!rows[0]) throw new HttpError(404, "Property not found");
  return rows[0];
}

/** Records the listing papers (already on IPFS and in the contract) in the database. */
async function saveListingPapers(propertyId, file, cid, userId) {
  await db.query(
    `INSERT INTO property_documents (property_id, kind, cid, chain_index, file_name, mime_type, size_bytes, uploaded_by)
     VALUES ($1, 'listing-papers', $2, NULL, $3, $4, $5, $6)`,
    [propertyId, cid, file.originalname, file.mimetype, file.size, userId]
  );
}

// Everyone can see a property's papers, and check them against the chain.
router.get("/properties/:id/documents", async (req, res) => {
  const p = await findProperty(req.params.id);
  const { rows } = await db.query("SELECT * FROM property_documents WHERE property_id = $1 ORDER BY id", [p.id]);
  const onChain = await chain.documentsOnChain(p.contract_address);
  const verified = (d) =>
    d.chain_index === null ? onChain.documentHash === `ipfs://${d.cid}` : onChain.cids[d.chain_index] === d.cid;
  res.json({ documents: rows.map((d) => publicDocument(d, verified(d))) });
});

// Form: "kind" (sale-deed, title-report, tax-receipt, rent-agreement, valuation, photo, other)
// and the file "document". The property's owner, an admin or the Land Authority can add papers.
router.post(
  "/properties/:id/documents",
  requireAuth, requireRole("owner", "admin", "land_authority"), upload.single("document"),
  async (req, res) => {
    const p = await findProperty(req.params.id);
    if (req.user.role === "owner" && p.owner_id !== req.user.id) throw new HttpError(404, "Property not found");
    const kind = v.oneOf(req.body || {}, "kind", KINDS);
    if (!req.file) throw new HttpError(400, "Please attach the file as \"document\"");
    if (!(await chain.hasPhase5Features(p.contract_address))) {
      throw new HttpError(409, "This property was listed before documents could be added. List it again to add papers");
    }

    const cid = await ipfs.add(req.file.buffer, req.file.originalname);
    const tx = await chain.addDocument(p.contract_address, cid, kind);
    const { rows } = await db.query(
      `INSERT INTO property_documents (property_id, kind, cid, chain_index, file_name, mime_type, size_bytes, uploaded_by, tx_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [p.id, kind, cid, tx.index, req.file.originalname, req.file.mimetype, req.file.size, req.user.id, tx.hash]
    );
    res.status(201).json({ document: publicDocument(rows[0], true) });
  }
);

// Downloads a paper from IPFS through the server.
router.get("/properties/:id/documents/:docId/file", async (req, res) => {
  const { rows } = await db.query(
    "SELECT * FROM property_documents WHERE id = $1 AND property_id = $2",
    [req.params.docId, req.params.id]
  );
  const d = rows[0];
  if (!d) throw new HttpError(404, "Document not found");
  const file = await ipfs.cat(d.cid);
  res.set("Content-Type", d.mime_type);
  res.set("Content-Disposition", `inline; filename="${d.file_name.replace(/[^\w.-]/g, "_")}"`);
  res.send(file);
});

module.exports = { router, saveListingPapers };
