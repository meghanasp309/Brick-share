const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const config = require("./config");

const pool = new Pool({ connectionString: config.databaseUrl });

/** Creates the tables if they don't exist yet. */
async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, "db", "schema.sql"), "utf8");
  await pool.query(sql);
}

module.exports = { pool, query: (text, params) => pool.query(text, params), migrate };
