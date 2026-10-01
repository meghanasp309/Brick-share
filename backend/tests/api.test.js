// Full story through the API, on the real database and Besu network.
// Start both first: see README ("Run the tests").
const { resetDatabase } = require("./setup");
const test = require("node:test");
const assert = require("node:assert");
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

test.before(resetDatabase);
test.after(() => db.pool.end());

test("health check sees the database and the blockchain", async () => {
  const res = await api().get("/health").expect(200);
  assert.strictEqual(res.body.blockchain.chainId, 2026);
});

test("signup, login and /me", async () => {
  const { token, user } = await signup("investor", "Alice@Example.com");
  assert.strictEqual(user.email, "alice@example.com");
  assert.strictEqual(user.kycStatus, "none");
  assert.match(user.walletAddress, /^0x/);
  assert.strictEqual(user.password_hash, undefined);

  const me = await api().get("/me").set(auth(token)).expect(200);
  assert.strictEqual(me.body.user.id, user.id);

  await login("alice@example.com", "password123");
  await api().post("/auth/login").send({ email: "alice@example.com", password: "wrong-pass" }).expect(401);
  await api().post("/auth/signup").send({ email: "alice@example.com", password: "password123", fullName: "A", role: "investor" }).expect(409);
});

test("signup rules", async () => {
  await api().post("/auth/signup").send({ email: "x@y.com", password: "short", fullName: "X", role: "investor" }).expect(400);
  await api().post("/auth/signup").send({ email: "not-an-email", password: "password123", fullName: "X", role: "investor" }).expect(400);
  // Nobody can make themselves an admin or Land Authority.
  await api().post("/auth/signup").send({ email: "x@y.com", password: "password123", fullName: "X", role: "admin" }).expect(400);
  await api().get("/me").expect(401);
  await api().get("/me").set(auth("garbage")).expect(401);
});

test("the full listing story: KYC, list, approve, freeze", async () => {
  const adminToken = await login("admin@brickshare.test", "admin123");
  const laToken = await login("land@brickshare.test", "land123");
  const owner = await signup("owner", "owner@example.com");
  const investor = await signup("investor", "bob@example.com");

  // An owner can't list before KYC is approved.
  await api().post("/properties").set(auth(owner.token)).field("name", "X").expect(403);

  // KYC: submit, see it in the admin queue, approve.
  await passKyc(owner.token, adminToken);
  const sub = await api().post("/kyc").set(auth(investor.token))
    .field("idType", "aadhaar").field("idNumber", "2345 6789 0123")
    .attach("document", fakeId, { filename: "id.pdf", contentType: "application/pdf" })
    .expect(201);
  assert.strictEqual(sub.body.submission.idLast4, "0123");
  await api().post("/kyc").set(auth(investor.token))
    .field("idType", "pan").field("idNumber", "ABCDE1234F")
    .attach("document", fakeId, { filename: "id.pdf", contentType: "application/pdf" })
    .expect(409); // already waiting
  const queue = await api().get("/admin/kyc").set(auth(adminToken)).expect(200);
  assert.ok(queue.body.submissions.some((s) => s.user.email === "bob@example.com"));
  await api().get("/admin/kyc").set(auth(investor.token)).expect(403);
  await api().get(`/admin/kyc/${sub.body.submission.id}/document`).set(auth(adminToken)).expect(200);
  await api().post(`/admin/kyc/${sub.body.submission.id}/approve`).set(auth(adminToken)).expect(200);
  await api().post(`/admin/kyc/${sub.body.submission.id}/approve`).set(auth(adminToken)).expect(409);

  // Owner lists a property: a new contract is deployed on the chain.
  const listed = await api().post("/properties").set(auth(owner.token))
    .field("name", "Whitefield Villa").field("symbol", "wfv").field("location", "Bengaluru")
    .field("totalShares", "10000").field("pricePerShare", "250")
    .attach("papers", Buffer.from("%PDF-1.4 sale deed"), { filename: "deed.pdf", contentType: "application/pdf" })
    .expect(201);
  const property = listed.body.property;
  assert.strictEqual(property.symbol, "WFV");
  assert.strictEqual(property.status, "pending");
  assert.match(property.documentHash, /^ipfs:\/\/b[a-z2-7]+$/); // the papers are on IPFS
  assert.match(property.contractAddress, /^0x/);

  // The already-verified investor was whitelisted on the new contract.
  assert.strictEqual(await chain.isWhitelisted(property.contractAddress, investor.user.walletAddress), true);

  let detail = await api().get(`/properties/${property.id}`).expect(200);
  assert.deepStrictEqual(detail.body.onChain, {
    status: "pending", frozen: false, freezeReason: null, sharesIssued: 0, ownerShares: 0,
  });

  // It can be frozen before approval, and then it can't be approved.
  await api().post(`/properties/${property.id}/freeze`).set(auth(laToken)).send({ reason: "Papers unclear" }).expect(200);
  const refused = await api().post(`/properties/${property.id}/approve`).set(auth(laToken)).expect(409);
  assert.match(refused.body.error, /frozen \(Papers unclear\)/);
  detail = await api().get(`/properties/${property.id}`).expect(200);
  assert.strictEqual(detail.body.onChain.status, "pending");
  assert.strictEqual(detail.body.onChain.frozen, true);
  await api().post(`/properties/${property.id}/unfreeze`).set(auth(laToken)).expect(200);

  // Only the Land Authority can approve.
  await api().post(`/properties/${property.id}/approve`).set(auth(owner.token)).expect(403);
  await api().post(`/properties/${property.id}/approve`).set(auth(laToken)).expect(200);
  await api().post(`/properties/${property.id}/approve`).set(auth(laToken)).expect(409); // AlreadyApproved
  detail = await api().get(`/properties/${property.id}`).expect(200);
  assert.strictEqual(detail.body.onChain.status, "approved");
  assert.strictEqual(detail.body.onChain.ownerShares, 10000);

  // A user verified after listing also gets whitelisted.
  const late = await signup("investor", "carol@example.com");
  await passKyc(late.token, adminToken);
  assert.strictEqual(await chain.isWhitelisted(property.contractAddress, late.user.walletAddress), true);

  // Freeze and unfreeze.
  await api().post(`/properties/${property.id}/freeze`).set(auth(laToken)).send({}).expect(400);
  await api().post(`/properties/${property.id}/freeze`).set(auth(laToken)).send({ reason: "Court case" }).expect(200);
  detail = await api().get(`/properties/${property.id}`).expect(200);
  assert.strictEqual(detail.body.onChain.frozen, true);
  assert.strictEqual(detail.body.property.freezeReason, "Court case");
  await api().post(`/properties/${property.id}/unfreeze`).set(auth(laToken)).expect(200);

  const list = await api().get("/properties?status=approved").expect(200);
  assert.strictEqual(list.body.properties.length, 1);
  assert.strictEqual(list.body.properties[0].frozen, false);
});

test("KYC reject and bad input", async () => {
  const adminToken = await login("admin@brickshare.test", "admin123");
  const { token } = await signup("investor", "dave@example.com");
  await api().post("/kyc").set(auth(token)).field("idType", "pan").field("idNumber", "ABCDE1234F").expect(400); // no file
  await api().post("/kyc").set(auth(token)).field("idType", "pan").field("idNumber", "ABCDE1234F")
    .attach("document", Buffer.from("hi"), { filename: "id.txt", contentType: "text/plain" }).expect(400);
  // ID numbers with the wrong shape are refused.
  for (const [idType, idNumber] of [
    ["aadhaar", "1234 5678 9012"], ["aadhaar", "2345678901"], ["aadhaar", "23456789012a"],
    ["pan", "ABCD1234F"], ["pan", "12345ABCDE"], ["passport", "12345678"], ["passport", "A123456"],
    ["pan", "x".repeat(500)],
  ]) {
    await api().post("/kyc").set(auth(token)).field("idType", idType).field("idNumber", idNumber)
      .attach("document", fakeId, { filename: "id.png", contentType: "image/png" }).expect(400);
  }
  const sub = await api().post("/kyc").set(auth(token)).field("idType", "pan").field("idNumber", "abcde1234f")
    .attach("document", fakeId, { filename: "id.png", contentType: "image/png" }).expect(201);
  await api().post(`/admin/kyc/${sub.body.submission.id}/reject`).set(auth(adminToken)).send({ note: "Blurry photo" }).expect(200);
  const mine = await api().get("/kyc").set(auth(token)).expect(200);
  assert.strictEqual(mine.body.kycStatus, "rejected");
  assert.strictEqual(mine.body.submission.reviewNote, "Blurry photo");

  await api().get("/properties/abc").expect(400);
  await api().get("/properties/99999").expect(404);
});
