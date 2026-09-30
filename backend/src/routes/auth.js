// Sign up, log in, and "who am I".
const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { HttpError } = require("../errors");
const { signToken, requireAuth, publicUser } = require("../auth");
const { createWallet } = require("../wallets");
const v = require("../validate");

const router = express.Router();

// Anyone can sign up as an investor or a property owner.
// Admin and Land Authority accounts are created by the server on start.
router.post("/auth/signup", async (req, res) => {
  const email = v.text(req.body, "email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "email is not valid");
  const password = v.text(req.body, "password", { max: 100 });
  if (password.length < 8) throw new HttpError(400, "password must be at least 8 characters");
  const fullName = v.text(req.body, "fullName", { max: 100 });
  const role = v.oneOf(req.body, "role", ["investor", "owner"]);

  const wallet = createWallet();
  const { rows } = await db.query(
    `INSERT INTO users (email, password_hash, full_name, role, wallet_address, wallet_key_enc)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (email) DO NOTHING RETURNING *`,
    [email, await bcrypt.hash(password, 10), fullName, role, wallet.address, wallet.encryptedKey]
  );
  if (!rows[0]) throw new HttpError(409, "An account with this email already exists");
  res.status(201).json({ token: signToken(rows[0]), user: publicUser(rows[0]) });
});

router.post("/auth/login", async (req, res) => {
  const email = v.text(req.body, "email").toLowerCase();
  const password = v.text(req.body, "password", { max: 100 });
  const { rows } = await db.query("SELECT * FROM users WHERE email = $1", [email]);
  if (!rows[0] || !(await bcrypt.compare(password, rows[0].password_hash))) {
    throw new HttpError(401, "Wrong email or password");
  }
  res.json({ token: signToken(rows[0]), user: publicUser(rows[0]) });
});

router.get("/me", requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

module.exports = router;
