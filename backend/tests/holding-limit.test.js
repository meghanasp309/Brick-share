// Max % per investor: the admin's platform limit, the owner's lower limit,
// and that buys from the owner and on the market both respect it.
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

async function buyFromOwner(token, shares) {
  const o = await api().post("/orders").set(auth(token)).send({ propertyId: property.id, shares }).expect(201);
  await api().post(`/orders/${o.body.order.id}/mock-pay`).set(auth(token)).expect(200);
}

let adminToken, laToken, owner, other, alice, bob, property;

test.before(async () => {
  await resetDatabase();
  adminToken = await login("admin@brickshare.test", "admin123");
  laToken = await login("land@brickshare.test", "land123");
  owner = await signup("owner", "owner@example.com");
  other = await signup("owner", "other-owner@example.com");
  alice = await signup("investor", "alice@example.com");
  bob = await signup("investor", "bob@example.com");
  for (const u of [owner, other, alice, bob]) await passKyc(u.token, adminToken);

  const listed = await api().post("/properties").set(auth(owner.token))
    .field("name", "Whitefield Flat").field("symbol", "WFF").field("location", "Bengaluru")
    .field("totalShares", "1000").field("pricePerShare", "100")
    .expect(201);
  property = listed.body.property;
  await api().post(`/properties/${property.id}/approve`).set(auth(laToken)).expect(200);

  const d = await api().post("/wallet/deposits").set(auth(bob.token)).send({ amount: 100000 }).expect(201);
  await api().post(`/wallet/deposits/${d.body.deposit.id}/mock-pay`).set(auth(bob.token)).expect(200);
});
test.after(async () => {
  await trading.idle();
  await db.pool.end();
});

test("the platform limit starts at 25% and only the admin can change it", async () => {
  assert.deepStrictEqual((await api().get("/settings").expect(200)).body, { maxHoldingPercent: 25 });
  const detail = (await api().get(`/properties/${property.id}`).expect(200)).body;
  assert.deepStrictEqual(detail.holdingLimit, { percent: 25, platformPercent: 25, ownerPercent: null, maxShares: 250 });

  await api().put("/admin/settings").set(auth(owner.token)).send({ maxHoldingPercent: 50 }).expect(403);
  await api().put("/admin/settings").set(auth(adminToken)).send({ maxHoldingPercent: 0 }).expect(400);
  await api().put("/admin/settings").set(auth(adminToken)).send({ maxHoldingPercent: 101 }).expect(400);
  await api().put("/admin/settings").set(auth(adminToken)).send({ maxHoldingPercent: 30 }).expect(200);
  assert.strictEqual((await api().get("/settings").expect(200)).body.maxHoldingPercent, 30);
  await api().put("/admin/settings").set(auth(adminToken)).send({ maxHoldingPercent: 25 }).expect(200);
});

test("the owner can set a lower limit, never a higher one", async () => {
  const url = `/properties/${property.id}/holding-limit`;
  await api().put(url).set(auth(alice.token)).send({ maxHoldingPercent: 10 }).expect(403);
  await api().put(url).set(auth(other.token)).send({ maxHoldingPercent: 10 }).expect(404); // not their property
  const tooHigh = await api().put(url).set(auth(owner.token)).send({ maxHoldingPercent: 40 }).expect(400);
  assert.match(tooHigh.body.error, /25%/);

  const set = await api().put(url).set(auth(owner.token)).send({ maxHoldingPercent: 10 }).expect(200);
  assert.strictEqual(set.body.property.maxHoldingPercent, 10);
  assert.deepStrictEqual(set.body.holdingLimit, { percent: 10, platformPercent: 25, ownerPercent: 10, maxShares: 100 });
  const { ticker } = (await api().get(`/market/${property.id}`).expect(200)).body;
  assert.deepStrictEqual(ticker.maxHolding, { percent: 10, shares: 100 });
});

test("buying from the owner stops at the limit", async () => {
  const over = await api().post("/orders").set(auth(alice.token)).send({ propertyId: property.id, shares: 101 }).expect(409);
  assert.match(over.body.error, /at most 10% of this property \(100 shares\)/);

  await buyFromOwner(alice.token, 60);
  // An unpaid order counts too, so it can't be used to get around the limit.
  await api().post("/orders").set(auth(alice.token)).send({ propertyId: property.id, shares: 30 }).expect(201);
  const more = await api().post("/orders").set(auth(alice.token)).send({ propertyId: property.id, shares: 11 }).expect(409);
  assert.match(more.body.error, /buy at most 10 more/);
  await buyFromOwner(alice.token, 10);
});

test("buy orders on the market stop at the limit too", async () => {
  // Bob buys his limit from the owner, then Alice offers him more on the market.
  await buyFromOwner(bob.token, 90);
  await api().post("/trading/orders").set(auth(alice.token))
    .send({ propertyId: property.id, side: "sell", shares: 20, price: 100 }).expect(201);

  // An open buy order counts: 5 waiting + 90 held = 95, so 6 more is too many.
  await api().post("/trading/orders").set(auth(bob.token))
    .send({ propertyId: property.id, side: "buy", shares: 5, price: 90 }).expect(201);
  const over = await api().post("/trading/orders").set(auth(bob.token))
    .send({ propertyId: property.id, side: "buy", shares: 6, price: 100 }).expect(409);
  assert.match(over.body.error, /buy at most 5 more/);

  const ok = await api().post("/trading/orders").set(auth(bob.token))
    .send({ propertyId: property.id, side: "buy", shares: 5, price: 100 }).expect(201);
  assert.strictEqual(ok.body.trades.length, 1);
  await trading.idle();
});

test("going back to the platform limit lets investors buy more", async () => {
  await api().put(`/properties/${property.id}/holding-limit`).set(auth(owner.token)).send({ maxHoldingPercent: null }).expect(200);
  // Bob holds 95 and has 5 in a buy order: 100 of the 250 allowed.
  await api().post("/trading/orders").set(auth(bob.token))
    .send({ propertyId: property.id, side: "buy", shares: 150, price: 90 }).expect(201);
  await api().post("/trading/orders").set(auth(bob.token))
    .send({ propertyId: property.id, side: "buy", shares: 1, price: 90 }).expect(409);
});
