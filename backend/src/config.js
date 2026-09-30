// All settings in one place. Values come from the .env file,
// with safe defaults for running on your own laptop.
require("dotenv").config({ quiet: true });

const env = (name, fallback) => process.env[name] || fallback;

const config = {
  port: Number(env("PORT", 4000)),
  databaseUrl: env("DATABASE_URL", "postgres://brickshare:brickshare@localhost:5432/brickshare"),
  jwtSecret: env("JWT_SECRET", "dev-jwt-secret-change-me"),
  walletSecret: env("WALLET_SECRET", "dev-wallet-secret-change-me"),
  rpcUrl: env("BESU_RPC_URL", "http://127.0.0.1:8545"),
  // DEV-ONLY keys (same as contracts/hardhat.config.js). Public on GitHub.
  platformKey: env("PLATFORM_KEY", "0xc710504cb32fc979d5080a3b5215f07ad8b33b58743876aaf695588ec9cf1ba7"),
  landAuthorityKey: env("LAND_AUTHORITY_KEY", "0xe028742a957ee5873864d789b2fbf1463b1184418da5d650d33c6f8b3f9291f1"),
  admin: {
    email: env("ADMIN_EMAIL", "admin@brickshare.test"),
    password: env("ADMIN_PASSWORD", "admin123"),
  },
  landAuthority: {
    email: env("LAND_AUTHORITY_EMAIL", "land@brickshare.test"),
    password: env("LAND_AUTHORITY_PASSWORD", "land123"),
  },
  uploadDir: env("UPLOAD_DIR", "uploads"),
  // Razorpay TEST keys (start with "rzp_test_"). Leave empty to use the
  // built-in fake payments ("mock" mode), which need no account.
  razorpay: {
    keyId: env("RAZORPAY_KEY_ID", ""),
    keySecret: env("RAZORPAY_KEY_SECRET", ""),
  },
  // How long an unpaid order keeps its shares reserved.
  orderMinutes: Number(env("ORDER_MINUTES", 15)),
};

if (config.razorpay.keyId && !config.razorpay.keyId.startsWith("rzp_test_")) {
  throw new Error("RAZORPAY_KEY_ID must be a TEST key (rzp_test_...). This is a demo: no real money.");
}

if (process.env.NODE_ENV === "production") {
  for (const name of ["JWT_SECRET", "WALLET_SECRET"]) {
    if (!process.env[name]) throw new Error(`${name} must be set in production`);
  }
}

module.exports = config;
