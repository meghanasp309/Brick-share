// Rent payouts and property papers on IPFS, on the real database, Besu
// network and IPFS node. Payments run in mock mode.
const { resetDatabase } = require("./setup");
const test = require("node:test");
const assert = require("node:assert");
const request = require("supertest");
const { createApp } = require("../src/app");
const chain = require("../src/chain");
const db = require("../src/db");
const trading = require("../src/trading");

const app = createApp();
const api = () => request(app);
const auth = (token) => ({ Authorization: `Bearer ${token}` });
const fakeId = Buffer.from("%PDF-1.4 fake id card");
const deed = Buffer.from("%PDF-1.4 sale deed for Koramangala Flat");

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

async function buy(token, propertyId, shares) {
  const o = await api().post("/orders").set(auth(token)).send({ propertyId, shares }).expect(201);
  await api().post(`/orders/${o.body.order.id}/mock-pay`).set(auth(token)).expect(200);
}

const wallet = async (token) => (await api().get("/wallet").set(auth(token)).expect(200)).body;

let adminToken, laToken, owner, otherOwner, alice, bob, property;

test.before(async () => {
  await resetDatabase();
  adminToken = await login("admin@brickshare.test", "admin123");
  laToken = await login("land@brickshare.test", "land123");
  owner = await signup("owner", "owner@example.com");
  otherOwner = await signup("owner", "other-owner@example.com");
  alice = await signup("investor", "alice@example.com");
  bob = await signup("investor", "bob@example.com");
  for (const u of [owner, otherOwner, alice, bob]) await passKyc(u.token, adminToken);

  const listed = await api().post("/properties").set(auth(owner.token))
    .field("name", "Koramangala Flat").field("symbol", "KMF").field("location", "Bengaluru")
    .field("totalShares", "1000").field("pricePerShare", "100")
    .attach("papers", deed, { filename: "deed.pdf", contentType: "application/pdf" })
    .expect(201);
  property = listed.body.property;
});
test.after(async () => {
  await trading.idle();
  await db.pool.end();
});

test("listing papers are stored on IPFS, and their CID is in the contract", async () => {
  const { body } = await api().get(`/properties/${property.id}/documents`).expect(200);
  assert.strictEqual(body.documents.length, 1);
  const papers = body.documents[0];
  assert.strictEqual(papers.kind, "listing-papers");
  assert.strictEqual(papers.fileName, "deed.pdf");
  assert.strictEqual(papers.verified, true);
  assert.strictEqual(property.documentHash, `ipfs://${papers.cid}`);
  const onChain = await chain.documentsOnChain(property.contractAddress);
  assert.strictEqual(onChain.documentHash, `ipfs://${papers.cid}`);

  // Download it back from IPFS: exactly the same bytes.
  const file = await api().get(papers.url).expect(200).expect("Content-Type", "application/pdf");
  assert.deepStrictEqual(file.body, deed);
});

test("more papers can be added later, each with its CID on-chain", async () => {
  const agreement = Buffer.from("%PDF-1.4 rent agreement");
  const add = (token, kind = "rent-agreement") =>
    api().post(`/properties/${property.id}/documents`).set(auth(token)).field("kind", kind)
      .attach("document", agreement, { filename: "rent agreement.pdf", contentType: "application/pdf" });

  await add(alice.token).expect(403); // investors can't
  await add(otherOwner.token).expect(404); // not their property
  await add(owner.token, "selfie").expect(400); // unknown kind
  await api().post(`/properties/${property.id}/documents`).set(auth(owner.token))
    .field("kind", "other").expect(400); // no file

  const { body } = await add(owner.token).expect(201);
  assert.strictEqual(body.document.kind, "rent-agreement");
  assert.strictEqual(body.document.verified, true);
  assert.match(body.document.transaction, /^0x/);
  assert.deepStrictEqual((await chain.documentsOnChain(property.contractAddress)).cids, [body.document.cid]);

  // The Land Authority can add papers too (e.g. a title report).
  await add(laToken, "title-report").expect(201);

  const list = (await api().get(`/properties/${property.id}/documents`).expect(200)).body.documents;
  assert.deepStrictEqual(list.map((d) => [d.kind, d.verified]), [
    ["listing-papers", true], ["rent-agreement", true], ["title-report", true],
  ]);
  const file = await api().get(list[1].url).expect(200);
  assert.deepStrictEqual(file.body, agreement);
  assert.match(file.headers["content-disposition"], /filename="rent_agreement.pdf"/);
});

test("rent can only be paid for an approved property, by its owner or an admin", async () => {
  await api().post(`/properties/${property.id}/rent`).set(auth(owner.token)).send({ amount: 1000 }).expect(409); // pending

  await api().post(`/properties/${property.id}/approve`).set(auth(laToken)).expect(200);
  await buy(alice.token, property.id, 200); // 20%
  await buy(bob.token, property.id, 50); // 5%

  await api().post(`/properties/${property.id}/rent`).set(auth(alice.token)).send({ amount: 1000 }).expect(403);
  await api().post(`/properties/${property.id}/rent`).set(auth(otherOwner.token)).send({ amount: 1000 }).expect(404);
  await api().post(`/properties/${property.id}/rent`).set(auth(owner.token)).send({ amount: 0 }).expect(400);
  await api().post(`/properties/${property.id}/rent`).set(auth(owner.token)).send({ amount: 1.001 }).expect(400);
});

test("rent is split by shares held, credited to wallets and recorded on-chain", async () => {
  const created = await api().post(`/properties/${property.id}/rent`).set(auth(owner.token))
    .send({ amount: 10000.33, period: "October 2026" }).expect(201);
  assert.strictEqual(created.body.payout.status, "created");
  assert.strictEqual(created.body.checkout.amount, 1000033); // paise
  const id = created.body.payout.id;

  // Only the payer (or an admin) can pay it.
  await api().post(`/rent/${id}/mock-pay`).set(auth(alice.token)).expect(404);

  const paid = await api().post(`/rent/${id}/mock-pay`).set(auth(owner.token)).expect(200);
  const payout = paid.body.payout;
  assert.strictEqual(payout.status, "distributed");
  assert.strictEqual(payout.failureReason, null);
  assert.match(payout.transaction, /^0x/);
  assert.strictEqual(payout.chainPayoutId, 1);

  // The contract agrees on each part: shares / 1000 x ₹10,000.33, rounded down.
  const owed = (u) => chain.rentOwed(property.contractAddress, payout.chainPayoutId, u.user.walletAddress);
  assert.strictEqual(await owed(alice), 200006); // 20%
  assert.strictEqual(await owed(bob), 50001); // 5%
  assert.strictEqual(await owed(owner), 750024); // 75%

  const a = await wallet(alice.token);
  assert.strictEqual(a.wallet.balance, 2000.06);
  assert.deepStrictEqual(
    [a.history[0].type, a.history[0].amount, a.history[0].property.id, a.history[0].rentPayoutId],
    ["rent", 2000.06, property.id, id]
  );
  assert.strictEqual((await wallet(bob.token)).wallet.balance, 500.01);
  // The owner keeps their 75% plus the 2 paise left over from rounding.
  assert.strictEqual((await wallet(owner.token)).wallet.balance, 7500.26);

  // Paying again changes nothing: the rent is never shared out twice.
  await api().post(`/rent/${id}/mock-pay`).set(auth(owner.token)).expect(200);
  assert.strictEqual((await wallet(alice.token)).wallet.balance, 2000.06);

  // Rent history, on the portfolio and on its own page.
  const portfolio = (await api().get("/portfolio").set(auth(alice.token)).expect(200)).body;
  assert.strictEqual(portfolio.holdings[0].rentEarned, 2000.06);
  assert.strictEqual(portfolio.totals.rentEarned, 2000.06);
  const received = (await api().get("/rent/received").set(auth(bob.token)).expect(200)).body;
  assert.strictEqual(received.total, 500.01);
  assert.deepStrictEqual(
    [received.received[0].amount, received.received[0].period, received.received[0].totalRent],
    [500.01, "October 2026", 10000.33]
  );
  const publicList = (await api().get(`/properties/${property.id}/rent`).expect(200)).body.payouts;
  assert.deepStrictEqual(publicList.map((p) => [p.id, p.amount]), [[id, 10000.33]]);

  // Owners can withdraw the rent they got.
  await api().post("/wallet/withdraw").set(auth(owner.token)).send({ amount: 7500.26 }).expect(200);
});

test("shares moved after a payout don't change it; the next payout uses the new balances", async () => {
  // Alice gives 100 shares to Bob through the order book.
  const d = await api().post("/wallet/deposits").set(auth(bob.token)).send({ amount: 20000 }).expect(201);
  await api().post(`/wallet/deposits/${d.body.deposit.id}/mock-pay`).set(auth(bob.token)).expect(200);
  await api().post("/trading/orders").set(auth(alice.token)).send({ propertyId: property.id, side: "sell", shares: 100, price: 100 }).expect(201);
  await api().post("/trading/orders").set(auth(bob.token)).send({ propertyId: property.id, side: "buy", shares: 100, price: 100 }).expect(201);
  await trading.idle();
  assert.strictEqual(await chain.balanceOf(property.contractAddress, bob.user.walletAddress), 150);

  // An admin pays this month. Alice now has 10%, Bob 15%.
  const created = await api().post(`/properties/${property.id}/rent`).set(auth(adminToken)).send({ amount: 1000 }).expect(201);
  const { payout } = (await api().post(`/rent/${created.body.payout.id}/mock-pay`).set(auth(adminToken)).expect(200)).body;
  assert.strictEqual(payout.status, "distributed");
  const received = async (token) => (await api().get("/rent/received").set(auth(token)).expect(200)).body.received[0].amount;
  assert.strictEqual(await received(alice.token), 100);
  assert.strictEqual(await received(bob.token), 150);
  assert.strictEqual(await received(owner.token), 750);
});

test("a frozen property pays no rent until it is unfrozen", async () => {
  // Rent paid before the freeze waits...
  const created = await api().post(`/properties/${property.id}/rent`).set(auth(owner.token)).send({ amount: 500 }).expect(201);
  await api().post(`/properties/${property.id}/freeze`).set(auth(laToken)).send({ reason: "Court case" }).expect(200);
  const before = (await wallet(alice.token)).wallet.balance;

  const waiting = (await api().post(`/rent/${created.body.payout.id}/mock-pay`).set(auth(owner.token)).expect(200)).body.payout;
  assert.strictEqual(waiting.status, "paid");
  assert.match(waiting.failureReason, /frozen \(Court case\)/);
  assert.strictEqual((await wallet(alice.token)).wallet.balance, before);
  await api().post(`/rent/${waiting.id}/retry`).set(auth(owner.token)).expect(200);
  assert.strictEqual((await api().get(`/rent/${waiting.id}`).set(auth(owner.token)).expect(200)).body.payout.status, "paid");

  // ...no new rent can be started while frozen...
  await api().post(`/properties/${property.id}/rent`).set(auth(owner.token)).send({ amount: 500 }).expect(409);

  // ...and it is shared out by itself when the Land Authority unfreezes.
  await api().post(`/properties/${property.id}/unfreeze`).set(auth(laToken)).expect(200);
  const done = (await api().get(`/rent/${waiting.id}`).set(auth(adminToken)).expect(200)).body.payout;
  assert.strictEqual(done.status, "distributed");
  assert.strictEqual((await wallet(alice.token)).wallet.balance, before + 50); // 10% of ₹500
});
