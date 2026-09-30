// Custodial wallets: BrickShare creates and holds a blockchain wallet for
// every user, so investors never deal with crypto themselves.
// Private keys are stored encrypted (AES-256-GCM) with WALLET_SECRET.
const crypto = require("crypto");
const { Wallet } = require("ethers");
const config = require("./config");

const key = crypto.createHash("sha256").update(config.walletSecret).digest();

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}

function decrypt(payload) {
  const [iv, tag, data] = payload.split(".").map((s) => Buffer.from(s, "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/** Makes a wallet. Pass a private key to reuse one (used for the dev accounts). */
function createWallet(privateKey) {
  const wallet = privateKey ? new Wallet(privateKey) : Wallet.createRandom();
  return { address: wallet.address, encryptedKey: encrypt(wallet.privateKey) };
}

/** Unlocks a user's wallet so the server can sign a transaction for them. */
function unlockWallet(encryptedKey, provider) {
  return new Wallet(decrypt(encryptedKey), provider);
}

module.exports = { encrypt, decrypt, createWallet, unlockWallet };
