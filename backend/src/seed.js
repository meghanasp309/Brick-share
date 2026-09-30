// Creates the Admin and Land Authority accounts if they don't exist yet.
// Their wallets use the dev keys, because those addresses have the
// blockchain roles (BrickShare platform and Land Authority).
const bcrypt = require("bcryptjs");
const config = require("./config");
const db = require("./db");
const { createWallet } = require("./wallets");

async function ensureUser({ email, password, fullName, role, privateKey }) {
  const wallet = createWallet(privateKey);
  await db.query(
    `INSERT INTO users (email, password_hash, full_name, role, wallet_address, wallet_key_enc, kyc_status)
     VALUES ($1, $2, $3, $4, $5, $6, 'approved')
     ON CONFLICT DO NOTHING`,
    [email.toLowerCase(), await bcrypt.hash(password, 10), fullName, role, wallet.address, wallet.encryptedKey]
  );
}

async function seed() {
  await ensureUser({ ...config.admin, fullName: "BrickShare Admin", role: "admin", privateKey: config.platformKey });
  await ensureUser({
    ...config.landAuthority, fullName: "Land Authority", role: "land_authority", privateKey: config.landAuthorityKey,
  });
}

module.exports = { seed };
