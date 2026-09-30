// Starts the BrickShare API: npm start
const config = require("./config");
const db = require("./db");
const { seed } = require("./seed");
const { createApp } = require("./app");
const live = require("./live");
const trading = require("./trading");

async function main() {
  await db.migrate();
  await seed();
  const server = createApp().listen(config.port, () => {
    console.log(`BrickShare API running at http://localhost:${config.port}`);
    console.log(`Check it: http://localhost:${config.port}/health`);
  });
  live.attach(server); // live prices and order book (Socket.io)
  const resumed = await trading.resumeSettlement();
  if (resumed) console.log(`Finishing ${resumed} trade(s) that were still settling`);
}

main().catch((err) => {
  if (err.code === "ECONNREFUSED") {
    console.error("Can't reach the database. Start it first: cd backend && docker compose up -d");
  } else {
    console.error(err);
  }
  process.exit(1);
});
