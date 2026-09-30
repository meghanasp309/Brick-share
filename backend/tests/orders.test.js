// Buying shares, portfolio and history, on the real database and Besu network.
// Payments run in mock mode (no Razorpay account needed).
const { resetDatabase } = require("./setup");
const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const request = require("supertest");
const { createApp } = require("../src/app");
const chain = require("../src/chain");
const db = require("../src/db");
const { MOCK_SECRET } = require("../src/payments");

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

// What Razorpay Checkout would hand back after a successful payment.
function razorpayProof(orderId) {
  const paymentId = "pay_" + crypto.randomBytes(6).toString("hex");
  const signature = crypto.createHmac("sha256", MOCK_SECRET).update(`${orderId}|${paymentId}`).digest("hex");
  return { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature };
}

let adminToken, laToken, owner, alice, bob, property;

test.before(async () => {
  await resetDatabase();
  adminToken = await login("admin@brickshare.test", "admin123");
  laToken = await login("land@brickshare.test", "land123");
  owner = await signup("owner", "owner@example.com");
  alice = await signup("investor", "alice@example.com");
  bob = await signup("investor", "bob@example.com");
  await passKyc(owner.token, adminToken);
  await passKyc(alice.token, adminToken);

  const listed = await api().post("/properties").set(auth(owner.token))
    .field("name", "Koramangala Flat").field("symbol", "KRM").field("location", "Bengaluru")
    .field("totalShares", "1000").field("pricePerShare", "250.50")
    .expect(201);
  property = listed.body.property;
});
test.after(() => db.pool.end());

const buy = (token, shares, propertyId = property.id) =>
  api().post("/orders").set(auth(token)).send({ propertyId, shares });

test("who can buy, and bad input", async () => {
  // Not approved by the Land Authority yet.
  await buy(alice.token, 10).expect(409);
  await api().post(`/properties/${property.id}/approve`).set(auth(laToken)).expect(200);

  await api().post("/orders").send({ propertyId: property.id, shares: 1 }).expect(401);
  await buy(owner.token, 10).expect(403); // owners don't buy
  await buy(bob.token, 10).expect(403); // no KYC yet
  await buy(alice.token, 0).expect(400);
  await buy(alice.token, 1.5).expect(400);
  await buy(alice.token, 10, 99999).expect(404);
  await buy(alice.token, 1001).expect(409); // more than exist
});

test("buy shares: order, pay, shares arrive on the chain", async () => {
  let detail = await api().get(`/properties/${property.id}`).expect(200);
  assert.strictEqual(detail.body.sharesForSale, 1000);

  const res = await buy(alice.token, 100).expect(201);
  const { order, checkout } = res.body;
  assert.strictEqual(order.status, "created");
  assert.strictEqual(order.amount, 25050); // 100 x ₹250.50
  assert.strictEqual(checkout.amount, 2505000); // in paise
  assert.strictEqual(checkout.mode, "mock");
  assert.strictEqual(checkout.orderId, order.razorpayOrderId);

  // The 100 shares are held for Alice while she pays.
  detail = await api().get(`/properties/${property.id}`).expect(200);
  assert.strictEqual(detail.body.sharesForSale, 900);

  // Forged or mismatched payment proofs are refused.
  const proof = razorpayProof(order.razorpayOrderId);
  await api().post(`/orders/${order.id}/verify`).set(auth(alice.token))
    .send({ ...proof, razorpay_signature: "0".repeat(64) }).expect(400);
  await api().post(`/orders/${order.id}/verify`).set(auth(alice.token))
    .send({ ...proof, razorpay_order_id: "order_other" }).expect(400);
  // Nobody else can confirm or even see Alice's order.
  await api().post(`/orders/${order.id}/verify`).set(auth(owner.token)).send(proof).expect(404);
  await api().get(`/orders/${order.id}`).set(auth(bob.token)).expect(404);

  const paid = await api().post(`/orders/${order.id}/verify`).set(auth(alice.token)).send(proof).expect(200);
  assert.strictEqual(paid.body.order.status, "completed");
  assert.match(paid.body.order.transaction, /^0x[0-9a-f]{64}$/);
  assert.strictEqual(await chain.balanceOf(property.contractAddress, alice.user.walletAddress), 100);

  // Sending the proof twice doesn't send the shares twice.
  const again = await api().post(`/orders/${order.id}/verify`).set(auth(alice.token)).send(proof).expect(200);
  assert.strictEqual(again.body.order.transaction, paid.body.order.transaction);
  assert.strictEqual(await chain.balanceOf(property.contractAddress, alice.user.walletAddress), 100);

  detail = await api().get(`/properties/${property.id}`).expect(200);
  assert.strictEqual(detail.body.onChain.ownerShares, 900);
  assert.strictEqual(detail.body.sharesForSale, 900);
});

test("can't buy more shares than are left", async () => {
  const big = await buy(alice.token, 850).expect(201);
  const res = await buy(alice.token, 100).expect(409);
  assert.match(res.body.error, /Only 50 shares are left/);

  // Once that order expires, its shares are free again.
  await db.query("UPDATE orders SET expires_at = now() - interval '1 minute' WHERE id = $1", [big.body.order.id]);
  await buy(alice.token, 100).expect(201);
  await db.query("UPDATE orders SET expires_at = now() - interval '1 minute' WHERE status = 'created'");
});

test("paid but the property got frozen: the order fails, and a retry works after unfreeze", async () => {
  const { order } = (await buy(alice.token, 20).expect(201)).body;
  await api().post(`/properties/${property.id}/freeze`).set(auth(laToken)).send({ reason: "Court case" }).expect(200);
  await buy(alice.token, 1).expect(409); // no new orders while frozen

  const paid = await api().post(`/orders/${order.id}/mock-pay`).set(auth(alice.token)).expect(200);
  assert.strictEqual(paid.body.order.status, "failed");
  assert.strictEqual(paid.body.order.failureReason, "Blockchain refused: PropertyFrozen");

  const failed = await api().get("/admin/orders?status=failed").set(auth(adminToken)).expect(200);
  assert.deepStrictEqual(failed.body.orders.map((o) => o.id), [order.id]);
  await api().get("/admin/orders").set(auth(alice.token)).expect(403);

  // The paid shares stay held for Alice, so nobody else can take them.
  let detail = await api().get(`/properties/${property.id}`).expect(200);
  assert.strictEqual(detail.body.sharesForSale, 880);

  await api().post(`/orders/${order.id}/retry`).set(auth(alice.token)).expect(200); // still frozen: fails again
  await api().post(`/properties/${property.id}/unfreeze`).set(auth(laToken)).expect(200);
  const retried = await api().post(`/orders/${order.id}/retry`).set(auth(adminToken)).expect(200);
  assert.strictEqual(retried.body.order.status, "completed");
  assert.strictEqual(retried.body.order.failureReason, null);
  await api().post(`/orders/${order.id}/retry`).set(auth(alice.token)).expect(409);
  await api().post(`/orders/${order.id}/mock-pay`).set(auth(alice.token)).expect(200); // already done, no second transfer
  assert.strictEqual(await chain.balanceOf(property.contractAddress, alice.user.walletAddress), 120);

  detail = await api().get(`/properties/${property.id}`).expect(200);
  assert.strictEqual(detail.body.sharesForSale, 880);
});

test("portfolio and transaction history", async () => {
  const mine = await api().get("/orders").set(auth(alice.token)).expect(200);
  assert.strictEqual(mine.body.orders.filter((o) => o.status === "completed").length, 2);

  const portfolio = await api().get("/portfolio").set(auth(alice.token)).expect(200);
  assert.strictEqual(portfolio.body.holdings.length, 1);
  const h = portfolio.body.holdings[0];
  assert.strictEqual(h.shares, 120);
  assert.strictEqual(h.ownership, 12);
  assert.strictEqual(h.value, 30060); // 120 x ₹250.50
  assert.strictEqual(h.invested, 30060);
  assert.deepStrictEqual(portfolio.body.totals, { properties: 1, value: 30060, invested: 30060 });

  const history = await api().get("/transactions").set(auth(alice.token)).expect(200);
  assert.deepStrictEqual(history.body.transactions.map((t) => [t.type, t.shares, t.amount]), [
    ["buy", 20, 5010],
    ["buy", 100, 25050],
  ]);

  // The owner sees the shares they were issued and the ones they sold.
  const ownerHistory = await api().get("/transactions").set(auth(owner.token)).expect(200);
  assert.deepStrictEqual(ownerHistory.body.transactions.map((t) => [t.type, t.shares]), [
    ["sell", 20], ["sell", 100], ["issued", 1000],
  ]);
  const ownerPortfolio = await api().get("/portfolio").set(auth(owner.token)).expect(200);
  assert.strictEqual(ownerPortfolio.body.holdings[0].shares, 880);

  const empty = await api().get("/portfolio").set(auth(bob.token)).expect(200);
  assert.deepStrictEqual(empty.body.holdings, []);
  await api().get("/portfolio").expect(401);
});
