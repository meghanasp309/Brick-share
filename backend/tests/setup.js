// Test setup: uses a separate database called "brickshare_test",
// wiped clean before the tests. Needs Docker running (database + Besu network).
const { Client } = require("pg");

const base = process.env.DATABASE_URL || "postgres://brickshare:brickshare@localhost:5432/brickshare";
const testUrl = new URL(base);
testUrl.pathname = "/brickshare_test";
process.env.DATABASE_URL = testUrl.toString();
// Always use fake payments in tests, even if your .env has Razorpay keys.
process.env.RAZORPAY_KEY_ID = "";
process.env.RAZORPAY_KEY_SECRET = "";
process.env.UPLOAD_DIR = require("path").join(require("os").tmpdir(), "brickshare-test-uploads");

async function resetDatabase() {
  const admin = new Client({ connectionString: base });
  await admin.connect();
  const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = 'brickshare_test'");
  if (!rowCount) await admin.query("CREATE DATABASE brickshare_test");
  await admin.end();

  const db = require("../src/db");
  await db.query("DROP TABLE IF EXISTS property_documents, rent_payouts, cash_entries, trades, book_orders, deposits, cash_accounts, orders, properties, kyc_submissions, users CASCADE");
  await db.migrate();
  await require("../src/seed").seed();
}

module.exports = { resetDatabase };
