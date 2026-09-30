// Deleting a property: allowed only while no investor holds shares,
// on the real database and Besu network. Payments run in mock mode.
const { resetDatabase } = require("./setup");
const test = require("node:test");
const assert = require("node:assert");
const request = require("supertest");
const { createApp } = require("../src/app");
const db = require("../src/db");
const trading = require("../src/trading");

const app = createApp();
const api = () => request(app);
const auth = (token) => ({ Authorization: `Bearer ${token}` });
const fakeId = Buffer.from("%PDF-1.4 fake id card");

const login = async (email, password) =>
  (await api().post("/auth/login").send({ email, password }).expect(200)).body.token;

const signup = async (role, email) =>
  (await api().post("/auth/signup").send({ email, password: "password123", fullName: `Test ${role}`, role }).expect(201)).body;

async function passKyc(token, adminToken) {
  const sub = await api().post("/kyc").set(auth(token))
    .field("idType", "pan").field("idNumber", "ABCDE1234F")
    .attach("document", fakeId, { filename: "id.pdf", contentType: "application/pdf" })
    .expect(201);
  await api().post(`/admin/kyc/${sub.body.submission.id}/approve`).set(auth(adminToken)).expect(200);
}

async function addMoney(token, amount) {
  const d = await api().post("/wallet/deposits").set(auth(token)).send({ amount }).expect(201);
  await api().post(`/wallet/deposits/${d.body.deposit.id}/mock-pay`).set(auth(token)).expect(200);
}

const wallet = async (token) => (await api().get("/wallet").set(auth(token)).expect(200)).body.wallet;

let adminToken, laToken, owner, other, alice;

async function list(name, symbol) {
  const res = await api().post("/properties").set(auth(owner.token))
    .field("name", name).field("symbol", symbol).field("location", "Bengaluru")
    .field("totalShares", "1000").field("pricePerShare", "100")
    .expect(201);
  return res.body.property;
}

const listedIds = async () => (await api().get("/properties").expect(200)).body.properties.map((p) => p.id);

test.before(async () => {
  await resetDatabase();
  adminToken = await login("admin@brickshare.test", "admin123");
  laToken = await login("land@brickshare.test", "land123");
  owner = await signup("owner", "owner@example.com");
  other = await signup("owner", "other@example.com");
  alice = await signup("investor", "alice@example.com");
  await passKyc(owner.token, adminToken);
  await passKyc(alice.token, adminToken);
});
test.after(async () => {
  await trading.idle();
  await db.pool.end();
});

test("a pending property can be deleted by its owner only", async () => {
  const p = await list("Pending Plot", "PPL");
  await api().delete(`/properties/${p.id}`).set(auth(other.token)).expect(404); // not theirs
  await api().delete(`/properties/${p.id}`).set(auth(alice.token)).expect(403); // investors can't

  const res = await api().delete(`/properties/${p.id}`).set(auth(owner.token)).expect(200);
  assert.match(res.body.message, /blockchain stays/);
  assert.ok(!(await listedIds()).includes(p.id));
  const gone = await api().get(`/properties/${p.id}`).expect(404);
  assert.match(gone.body.error, /removed/);
  // The Land Authority can't approve it any more.
  await api().post(`/properties/${p.id}/approve`).set(auth(laToken)).expect(404);
  await api().delete(`/properties/${p.id}`).set(auth(owner.token)).expect(404);
});

test("a frozen property can't be deleted", async () => {
  const p = await list("Frozen Flat", "FZF");
  await api().post(`/properties/${p.id}/freeze`).set(auth(laToken)).send({ reason: "Court case" }).expect(200);
  const res = await api().delete(`/properties/${p.id}`).set(auth(owner.token)).expect(409);
  assert.match(res.body.error, /froze/);
});

test("an approved property: open buy orders are cancelled and rent stops", async () => {
  const p = await list("Empty Tower", "ETW");
  await api().post(`/properties/${p.id}/approve`).set(auth(laToken)).expect(200);
  await api().put(`/properties/${p.id}/rent-schedule`).set(auth(owner.token)).send({ amount: 1000, active: false }).expect(200);

  // Alice wants to buy from other investors, but nobody sells: her money is held.
  await addMoney(alice.token, 5000);
  const o = await api().post("/trading/orders").set(auth(alice.token))
    .send({ propertyId: p.id, side: "buy", shares: 10, price: 100 }).expect(201);
  assert.strictEqual((await wallet(alice.token)).held, 1000);

  // Admins can delete any property.
  const res = await api().delete(`/properties/${p.id}`).set(auth(adminToken)).expect(200);
  assert.strictEqual(res.body.cancelledOrders, 1);
  const mine = await api().get(`/trading/orders/${o.body.order.id}`).set(auth(alice.token)).expect(200);
  assert.strictEqual(mine.body.order.status, "cancelled");
  assert.strictEqual((await wallet(alice.token)).held, 0);

  const { rows } = await db.query("SELECT active FROM rent_schedules WHERE property_id = $1", [p.id]);
  assert.strictEqual(rows[0].active, false);
  const market = await api().get("/market").expect(200);
  assert.ok(!market.body.markets.some((m) => m.propertyId === p.id));
  await api().post("/orders").set(auth(alice.token)).send({ propertyId: p.id, shares: 1 }).expect(409);
  await api().post("/trading/orders").set(auth(alice.token))
    .send({ propertyId: p.id, side: "buy", shares: 1, price: 100 }).expect(409);
});

test("an approved property with investors can't be deleted", async () => {
  const p = await list("Busy Villa", "BSV");
  await api().post(`/properties/${p.id}/approve`).set(auth(laToken)).expect(200);

  // Alice is paying for shares right now.
  const o = await api().post("/orders").set(auth(alice.token)).send({ propertyId: p.id, shares: 5 }).expect(201);
  let res = await api().delete(`/properties/${p.id}`).set(auth(owner.token)).expect(409);
  assert.match(res.body.error, /buying shares/);

  // Now she holds them.
  await api().post(`/orders/${o.body.order.id}/mock-pay`).set(auth(alice.token)).expect(200);
  res = await api().delete(`/properties/${p.id}`).set(auth(owner.token)).expect(409);
  assert.match(res.body.error, /Investors hold 5 of its shares/);
  assert.ok((await listedIds()).includes(p.id));
});
