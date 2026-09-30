// Fills BrickShare with demo data, so every screen has something to show.
//
//   npm run demo-data        (the backend must be running: npm start)
//
// It uses the API like a real user would: people sign up and send their ID,
// the admin approves them, the owner lists 3 properties, the Land Authority
// approves them, investors buy, add money and trade, the owner pays rent,
// and one property gets frozen. Payments are fake (mock mode).
//
// Everyone's password is demo1234. Run it once on a fresh database.
const config = require("../src/config");
const db = require("../src/db");

const API = process.env.API_URL || `http://localhost:${config.port}`;
const PASSWORD = "demo1234";

const PEOPLE = {
  owner: { email: "owner@demo.test", fullName: "Priya Sharma", role: "owner" },
  alice: { email: "alice@demo.test", fullName: "Alice Menon", role: "investor" },
  bob: { email: "bob@demo.test", fullName: "Bob Kumar", role: "investor" },
};

const PROPERTIES = [
  { key: "flat", name: "Sea View Flat", symbol: "SVF", location: "Bandra, Mumbai", totalShares: 10000, pricePerShare: 500,
    description: "2 BHK flat facing the sea, rented to a family since 2024." },
  { key: "office", name: "Tech Park Office", symbol: "TPO", location: "Whitefield, Bengaluru", totalShares: 5000, pricePerShare: 1000,
    description: "Office floor in an IT park, leased to a software company." },
  { key: "villa", name: "Green Villa", symbol: "GRV", location: "Baner, Pune", totalShares: 2000, pricePerShare: 250,
    description: "3 BHK villa with a garden. Used in the demo to show a Land Authority freeze." },
];

// A tiny, valid PDF, used as the ID card and the property papers.
const pdf = (text) => Buffer.from(
  `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n` +
  `3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 100]>>endobj\n% ${text}\ntrailer<</Root 1 0 R>>\n%%EOF\n`
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (text) => console.log(`- ${text}`);

async function call(method, path, { token, body, form } = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  let payload;
  if (form) {
    payload = new FormData();
    for (const [k, v] of Object.entries(form)) {
      if (Buffer.isBuffer(v)) payload.append(k, new Blob([v], { type: "application/pdf" }), `${k}.pdf`);
      else payload.append(k, String(v));
    }
  } else if (body) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(API + path, { method, headers, body: payload });
  } catch {
    throw new Error(`Can't reach the backend at ${API}. Start it first: cd backend, then npm start`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} failed (${res.status}): ${data.error || "unknown error"}`);
  return data;
}

const login = async (email, password) => (await call("POST", "/auth/login", { body: { email, password } })).token;

/** Waits until none of this user's trades are still moving on the blockchain. */
async function tradesSettled(token) {
  for (let i = 0; i < 60; i++) {
    const { trades } = await call("GET", "/trading/trades", { token });
    if (!trades.some((t) => t.status === "settling")) return trades;
    await sleep(1000);
  }
  throw new Error("Trades are taking too long to settle. Is the blockchain running?");
}

async function pay(kind, id, token) {
  const paths = { order: `/orders/${id}/mock-pay`, deposit: `/wallet/deposits/${id}/mock-pay`, rent: `/rent/${id}/mock-pay` };
  return call("POST", paths[kind], { token });
}

async function main() {
  const health = await call("GET", "/health");
  console.log(`Backend is up. Blockchain block #${health.blockchain.blockNumber}.`);

  const admin = await login(config.admin.email, config.admin.password);
  const land = await login(config.landAuthority.email, config.landAuthority.password);

  // Stop if the demo data is already there.
  const { users } = await call("GET", "/admin/users", { token: admin });
  if (users.some((u) => u.email === PEOPLE.owner.email)) {
    console.log("Demo data is already there. To start over, reset the database:");
    console.log("  cd backend && docker compose down -v && docker compose up -d   (then restart the backend)");
    return;
  }
  if (health.payments !== "mock") {
    throw new Error("Demo data needs fake payments. Remove RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET from backend/.env");
  }

  console.log("\n1. People sign up and send their ID (KYC)");
  const t = {};
  for (const [key, p] of Object.entries(PEOPLE)) {
    t[key] = (await call("POST", "/auth/signup", { body: { ...p, password: PASSWORD } })).token;
    const { submission } = await call("POST", "/kyc", {
      token: t[key], form: { idType: "pan", idNumber: `DEMO${key.toUpperCase().padEnd(5, "X")}1F`, document: pdf(`ID card of ${p.fullName}`) },
    });
    await call("POST", `/admin/kyc/${submission.id}/approve`, { token: admin });
    step(`${p.fullName} (${p.role}) signed up, admin approved the ID, wallet whitelisted on-chain`);
  }

  console.log("\n2. The owner lists 3 properties, the Land Authority approves them");
  const prop = {};
  for (const p of PROPERTIES) {
    const { key, ...fields } = p;
    const { property } = await call("POST", "/properties", {
      token: t.owner, form: { ...fields, papers: pdf(`Sale deed of ${p.name}`) },
    });
    await call("POST", `/properties/${property.id}/approve`, { token: land });
    prop[key] = property;
    step(`${p.name}: ${p.totalShares} shares at ₹${p.pricePerShare}, papers on IPFS, approved`);
  }

  console.log("\n3. Investors buy shares from the owner (fake payment)");
  for (const [who, key, shares] of [["alice", "flat", 600], ["bob", "flat", 400], ["alice", "office", 200], ["bob", "villa", 300]]) {
    const { order } = await call("POST", "/orders", { token: t[who], body: { propertyId: prop[key].id, shares } });
    const paid = await pay("order", order.id, t[who]);
    if (paid.order.status !== "completed") throw new Error(`Order ${order.id} did not complete: ${paid.order.failureReason}`);
    step(`${PEOPLE[who].fullName} bought ${shares} shares of ${prop[key].name}`);
  }

  console.log("\n4. Investors add money to their wallets");
  for (const who of ["alice", "bob"]) {
    const { deposit } = await call("POST", "/wallet/deposits", { token: t[who], body: { amount: 200000 } });
    await pay("deposit", deposit.id, t[who]);
    step(`${PEOPLE[who].fullName} added ₹2,00,000`);
  }

  console.log("\n5. Alice and Bob trade Sea View Flat shares on the order book");
  // Prices move up and down a little, like a real market (the same every run).
  const prices = [];
  let lastPrice = 500;
  for (let i = 0; i < 30; i++) {
    lastPrice += [4, -3, 6, -5, 2, 7, -4, 3, -2, 5][i % 10] + (i % 4 === 0 ? 1 : 0);
    prices.push(lastPrice);
  }
  for (const [i, p] of prices.entries()) {
    const [seller, buyer] = i % 2 ? ["bob", "alice"] : ["alice", "bob"];
    const shares = 5 + ((i * 7) % 20);
    await call("POST", "/trading/orders", { token: t[seller], body: { propertyId: prop.flat.id, side: "sell", shares, price: p } });
    await call("POST", "/trading/orders", { token: t[buyer], body: { propertyId: prop.flat.id, side: "buy", shares, price: p } });
  }
  const trades = await tradesSettled(t.alice);
  await tradesSettled(t.bob);
  step(`${prices.length} trades settled on the blockchain`);

  // Spread these trades over the last few hours, 3 trades every 15 minutes,
  // so the price chart has candles to show. (Only the time is changed: the
  // trades themselves are real and on the chain.)
  const ids = trades.map((tr) => tr.id).sort((a, b) => a - b);
  for (const [i, id] of ids.entries()) {
    const slotsAgo = Math.ceil(ids.length / 3) - Math.floor(i / 3);
    await db.query(
      `UPDATE trades SET created_at = date_bin('15 minutes', now(), TIMESTAMPTZ '2000-01-01')
         - make_interval(mins => $2) + make_interval(mins => $3) WHERE id = $1`,
      [id, slotsAgo * 15, i % 3]
    );
  }
  step("spread the trades over the last few hours for the chart");

  // Leave some offers on the book so the order book isn't empty.
  for (const [who, side, shares, price] of [
    ["bob", "buy", 20, lastPrice - 5], ["bob", "buy", 15, lastPrice - 10], ["alice", "sell", 25, lastPrice + 8], ["alice", "sell", 10, lastPrice + 15],
  ]) {
    await call("POST", "/trading/orders", { token: t[who], body: { propertyId: prop.flat.id, side, shares, price } });
  }
  step("left 2 buy offers and 2 sell offers waiting on the order book");

  console.log("\n6. The owner pays rent, and it is shared out to every holder");
  const { payout } = await call("POST", `/properties/${prop.flat.id}/rent`, {
    token: t.owner, body: { amount: 50000, period: "September 2026" },
  });
  const done = await pay("rent", payout.id, t.owner);
  step(`₹50,000 rent for Sea View Flat: ${done.payout.status}`);

  console.log("\n7. The Land Authority freezes Green Villa");
  await call("POST", `/properties/${prop.villa.id}/freeze`, { token: land, body: { reason: "Ownership dispute in court (demo)" } });
  step("Green Villa is frozen: nobody can buy or sell its shares");

  console.log("\nDone! Open http://localhost:3000 and log in as:");
  console.table([
    ...Object.values(PEOPLE).map((p) => ({ role: p.role, email: p.email, password: PASSWORD })),
    { role: "admin", email: config.admin.email, password: config.admin.password },
    { role: "land authority", email: config.landAuthority.email, password: config.landAuthority.password },
  ]);
}

main()
  .catch((err) => {
    console.error(`\n${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
