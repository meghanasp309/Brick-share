// Simulated KYC: the user uploads an ID, an admin approves it, and the
// user's wallet is added to the whitelist of every property on the chain.
const fs = require("fs");
const path = require("path");
const express = require("express");
const db = require("../db");
const chain = require("../chain");
const { HttpError } = require("../errors");
const { requireAuth, requireRole, publicUser } = require("../auth");
const { uploader } = require("../uploads");
const v = require("../validate");

const router = express.Router();
const upload = uploader("kyc");

const publicSubmission = (s) => ({
  id: s.id,
  userId: s.user_id,
  idType: s.id_type,
  idLast4: s.id_last4,
  status: s.status,
  reviewNote: s.review_note,
  reviewedAt: s.reviewed_at,
  createdAt: s.created_at,
  ...(s.email && { user: { email: s.email, fullName: s.full_name, role: s.role, walletAddress: s.wallet_address } }),
});

// ---------- For investors and owners ----------

// Form fields: idType (aadhaar, pan, passport), idNumber, and a file called "document".
router.post("/kyc", requireAuth, requireRole("investor", "owner"), upload.single("document"), async (req, res) => {
  try {
    if (!req.file) throw new HttpError(400, "Please attach a photo or PDF of your ID as 'document'");
    if (req.user.kyc_status === "approved") throw new HttpError(409, "Your KYC is already approved");
    if (req.user.kyc_status === "pending") throw new HttpError(409, "Your KYC is already waiting for review");
    const idType = v.oneOf(req.body, "idType", ["aadhaar", "pan", "passport"]);
    const idNumber = v.idNumber(req.body, "idNumber", idType);

    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `INSERT INTO kyc_submissions (user_id, id_type, id_last4, document_path)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [req.user.id, idType, idNumber.slice(-4), req.file.path]
      );
      await client.query("UPDATE users SET kyc_status = 'pending' WHERE id = $1", [req.user.id]);
      await client.query("COMMIT");
      res.status(201).json({ submission: publicSubmission(rows[0]) });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    if (req.file) fs.rmSync(req.file.path, { force: true });
    throw err;
  }
});

router.get("/kyc", requireAuth, async (req, res) => {
  const { rows } = await db.query(
    "SELECT * FROM kyc_submissions WHERE user_id = $1 ORDER BY id DESC LIMIT 1",
    [req.user.id]
  );
  res.json({ kycStatus: req.user.kyc_status, submission: rows[0] ? publicSubmission(rows[0]) : null });
});

// ---------- For admins ----------

const admin = express.Router();
admin.use(requireAuth, requireRole("admin"));

admin.get("/kyc", async (req, res) => {
  const status = req.query.status || "pending";
  const { rows } = await db.query(
    `SELECT k.*, u.email, u.full_name, u.role, u.wallet_address
     FROM kyc_submissions k JOIN users u ON u.id = k.user_id
     WHERE k.status = $1 ORDER BY k.id`,
    [status]
  );
  res.json({ submissions: rows.map(publicSubmission) });
});

async function findPending(id) {
  const { rows } = await db.query(
    `SELECT k.*, u.wallet_address FROM kyc_submissions k JOIN users u ON u.id = k.user_id WHERE k.id = $1`,
    [id]
  );
  if (!rows[0]) throw new HttpError(404, "KYC submission not found");
  if (rows[0].status !== "pending") throw new HttpError(409, `This submission is already ${rows[0].status}`);
  return rows[0];
}

admin.get("/kyc/:id/document", async (req, res) => {
  const { rows } = await db.query("SELECT document_path FROM kyc_submissions WHERE id = $1", [req.params.id]);
  if (!rows[0]) throw new HttpError(404, "KYC submission not found");
  res.sendFile(path.resolve(rows[0].document_path));
});

admin.post("/kyc/:id/approve", async (req, res) => {
  const sub = await findPending(req.params.id);

  // Whitelist the wallet on every property first. If the chain fails,
  // nothing is saved and the admin can simply try again.
  const { rows: props } = await db.query("SELECT contract_address FROM properties ORDER BY id");
  const txs = [];
  for (const p of props) {
    const hash = await chain.addToWhitelist(p.contract_address, sub.wallet_address);
    if (hash) txs.push(hash);
  }

  await db.query(
    `UPDATE kyc_submissions SET status = 'approved', review_note = $2, reviewed_by = $3, reviewed_at = now() WHERE id = $1`,
    [sub.id, req.body?.note || null, req.user.id]
  );
  await db.query("UPDATE users SET kyc_status = 'approved' WHERE id = $1", [sub.user_id]);
  res.json({ status: "approved", whitelistedOn: props.length, transactions: txs });
});

admin.post("/kyc/:id/reject", async (req, res) => {
  const sub = await findPending(req.params.id);
  const note = v.text(req.body || {}, "note", { max: 500 });
  await db.query(
    `UPDATE kyc_submissions SET status = 'rejected', review_note = $2, reviewed_by = $3, reviewed_at = now() WHERE id = $1`,
    [sub.id, note, req.user.id]
  );
  await db.query("UPDATE users SET kyc_status = 'rejected' WHERE id = $1", [sub.user_id]);
  res.json({ status: "rejected" });
});

admin.get("/users", async (_req, res) => {
  const { rows } = await db.query("SELECT * FROM users ORDER BY id");
  res.json({ users: rows.map(publicUser) });
});

module.exports = { kyc: router, admin };
