// Razorpay webhooks, and the live network view, on the real database and Besu network.
const { resetDatabase } = require("./setup");
const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const request = require("supertest");
const { createApp } = require("../src/app");
const chain = require("../src/chain");
const db = require("../src/db");

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

/** Sends a webhook the way Razorpay does: JSON body, signed with the webhook secret. */
function webhook(event, orderId, amount, { secret = "test-webhook-secret", paymentId } = {}) {
  const body = JSON.stringify({
    event,
    payload: {
      payment: { entity: { id: paymentId || "pay_" + crypto.randomBytes(6).toString("hex"), order_id: orderId, amount, status: "captured" } },
    },
  });
  const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return api().post("/payments/webhook").set("Content-Type", "application/json").set("X-Razorpay-Signature", signature).send(body);
}

async function waitFor(check) {
  for (let i = 0; i < 60; i++) {
    const value = await check();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("timed out");
}

let adminToken, laToken, owner, alice, property;

test.before(async () => {
  await resetDatabase();
  adminToken = await login("admin@brickshare.test", "admin123");
  laToken = await login("land@brickshare.test", "land123");
  owner = await signup("owner", "owner@example.com");
  alice = await signup("investor", "alice@example.com");
  await passKyc(owner.token, adminToken);
  await passKyc(alice.token, adminToken);
  const listed = await api().post("/properties").set(auth(owner.token))
    .field("name", "Webhook Villa").field("symbol", "WHV").field("location", "Pune")
    .field("totalShares", "1000").field("pricePerShare", "100")
    .expect(201);
  property = listed.body.property;
  await api().post(`/properties/${property.id}/approve`).set(auth(laToken)).expect(200);
});
test.after(() => db.pool.end());

test("refuses webhooks that Razorpay didn't sign", async () => {
  const { order } = (await api().post("/orders").set(auth(alice.token)).send({ propertyId: property.id, shares: 10 }).expect(201)).body;
  await webhook("payment.captured", order.razorpayOrderId, 100000, { secret: "wrong" }).expect(400);
  await api().post("/payments/webhook").send({ event: "payment.captured" }).expect(400); // no signature
  // Signed, but the amount is wrong.
  await webhook("payment.captured", order.razorpayOrderId, 1).expect(400);
  const still = await api().get(`/orders/${order.id}`).set(auth(alice.token)).expect(200);
  assert.strictEqual(still.body.order.status, "created");
  // Events we don't use, and orders we don't know, are fine but ignored.
  await webhook("refund.created", order.razorpayOrderId, 100000).expect(200);
  const unknown = await webhook("payment.captured", "order_unknown", 100).expect(200);
  assert.strictEqual(unknown.body.ignored, "unknown order");
});

test("investor paid but closed the app: the webhook still delivers the shares, once", async () => {
  const { order } = (await api().post("/orders").set(auth(alice.token)).send({ propertyId: property.id, shares: 20 }).expect(201)).body;
  const paymentId = "pay_webhook_1";
  await webhook("payment.captured", order.razorpayOrderId, 200000, { paymentId }).expect(200);
  // Razorpay may send the same news twice (and order.paid too).
  await webhook("order.paid", order.razorpayOrderId, 200000, { paymentId }).expect(200);

  const done = await waitFor(async () => {
    const o = (await api().get(`/orders/${order.id}`).set(auth(alice.token)).expect(200)).body.order;
    return o.status === "completed" && o;
  });
  assert.strictEqual(done.razorpayPaymentId, paymentId);
  assert.strictEqual(await chain.balanceOf(property.contractAddress, alice.user.walletAddress), 20);
});

test("a wallet deposit is added by the webhook, once", async () => {
  const { deposit } = (await api().post("/wallet/deposits").set(auth(alice.token)).send({ amount: 500 }).expect(201)).body;
  await webhook("payment.captured", deposit.razorpayOrderId, 50000).expect(200);
  await webhook("payment.captured", deposit.razorpayOrderId, 50000).expect(200);
  const wallet = (await api().get("/wallet").set(auth(alice.token)).expect(200)).body.wallet;
  assert.strictEqual(wallet.balance, 500);
  // The app's own confirmation afterwards is fine too, and adds nothing.
  await api().post(`/wallet/deposits/${deposit.id}/mock-pay`).set(auth(alice.token)).expect(200);
  assert.strictEqual((await api().get("/wallet").set(auth(alice.token)).expect(200)).body.wallet.balance, 500);
});

test("rent paid through the webhook is shared out", async () => {
  const { payout } = (await api().post(`/properties/${property.id}/rent`).set(auth(owner.token))
    .send({ amount: 1000, period: "Webhook month" }).expect(201)).body;
  await webhook("order.paid", payout.razorpayOrderId, 100000).expect(200);
  await waitFor(async () => (await api().get(`/rent/${payout.id}`).set(auth(owner.token)).expect(200)).body.payout.status === "distributed");
  const received = (await api().get("/rent/received").set(auth(alice.token)).expect(200)).body;
  assert.strictEqual(received.total, 20); // Alice holds 2% of the shares: 2% of ₹1,000
});

test("the network view shows all 4 nodes agreeing", async () => {
  const res = await api().get("/network").expect(200);
  assert.strictEqual(res.body.total, 4);
  assert.strictEqual(res.body.online, 4);
  assert.strictEqual(res.body.healthy, true);
  for (const n of res.body.nodes) {
    assert.strictEqual(n.inSync, true);
    assert.ok(n.blockNumber > 0);
    assert.strictEqual(n.peers, 3);
  }
});
