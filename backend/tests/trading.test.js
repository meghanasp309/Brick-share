// Rupee wallet, order book, matching, on-chain settlement, charts and live
// updates, on the real database and Besu network. Payments run in mock mode.
const { resetDatabase } = require("./setup");
const test = require("node:test");
const assert = require("node:assert");
const request = require("supertest");
const { io: connect } = require("socket.io-client");
const { createApp } = require("../src/app");
const chain = require("../src/chain");
const db = require("../src/db");
const live = require("../src/live");
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
  return (await api().post(`/wallet/deposits/${d.body.deposit.id}/mock-pay`).set(auth(token)).expect(200)).body;
}

const wallet = async (token) => (await api().get("/wallet").set(auth(token)).expect(200)).body.wallet;

let adminToken, laToken, owner, alice, bob, carol, property;

const order = (token, side, shares, price, propertyId = property.id) =>
  api().post("/trading/orders").set(auth(token)).send({ propertyId, side, shares, price });

test.before(async () => {
  await resetDatabase();
  adminToken = await login("admin@brickshare.test", "admin123");
  laToken = await login("land@brickshare.test", "land123");
  owner = await signup("owner", "owner@example.com");
  alice = await signup("investor", "alice@example.com");
  bob = await signup("investor", "bob@example.com");
  carol = await signup("investor", "carol@example.com"); // no KYC
  await passKyc(owner.token, adminToken);
  await passKyc(alice.token, adminToken);
  await passKyc(bob.token, adminToken);

  const listed = await api().post("/properties").set(auth(owner.token))
    .field("name", "Indiranagar Villa").field("symbol", "IDV").field("location", "Bengaluru")
    .field("totalShares", "1000").field("pricePerShare", "100")
    .expect(201);
  property = listed.body.property;
  await api().post(`/properties/${property.id}/approve`).set(auth(laToken)).expect(200);

  // Alice buys 200 shares from the owner (the primary sale from phase 3).
  const o = await api().post("/orders").set(auth(alice.token)).send({ propertyId: property.id, shares: 200 }).expect(201);
  await api().post(`/orders/${o.body.order.id}/mock-pay`).set(auth(alice.token)).expect(200);
});
test.after(async () => {
  await trading.idle();
  await db.pool.end();
});

test("wallet: add money, withdraw, and who can use it", async () => {
  await api().post("/wallet/deposits").set(auth(carol.token)).send({ amount: 100 }).expect(403); // no KYC
  await order(owner.token, "buy", 1, 100).expect(403); // owners don't trade (they can add money to pay rent)
  await api().post("/wallet/deposits").set(auth(bob.token)).send({ amount: 0 }).expect(400);
  await api().post("/wallet/deposits").set(auth(bob.token)).send({ amount: 10.123 }).expect(400);

  const d = await api().post("/wallet/deposits").set(auth(bob.token)).send({ amount: 50000 }).expect(201);
  assert.strictEqual(d.body.checkout.amount, 5000000); // paise
  assert.strictEqual((await wallet(bob.token)).balance, 0); // not paid yet

  // Someone else can't pay into Bob's deposit, and a wrong signature is refused.
  await api().post(`/wallet/deposits/${d.body.deposit.id}/mock-pay`).set(auth(alice.token)).expect(404);
  await api().post(`/wallet/deposits/${d.body.deposit.id}/verify`).set(auth(bob.token))
    .send({ razorpay_order_id: d.body.deposit.razorpayOrderId, razorpay_payment_id: "pay_x", razorpay_signature: "bad" })
    .expect(400);

  const paid = await api().post(`/wallet/deposits/${d.body.deposit.id}/mock-pay`).set(auth(bob.token)).expect(200);
  assert.strictEqual(paid.body.wallet.balance, 50000);
  // Paying twice doesn't add the money twice.
  await api().post(`/wallet/deposits/${d.body.deposit.id}/mock-pay`).set(auth(bob.token)).expect(200);
  assert.strictEqual((await wallet(bob.token)).balance, 50000);

  await api().post("/wallet/withdraw").set(auth(bob.token)).send({ amount: 60000 }).expect(409);
  const w = await api().post("/wallet/withdraw").set(auth(bob.token)).send({ amount: 1000 }).expect(200);
  assert.deepStrictEqual(w.body.wallet, { balance: 49000, held: 0, available: 49000, currency: "INR" });

  const history = (await api().get("/wallet").set(auth(bob.token)).expect(200)).body.history;
  assert.deepStrictEqual(history.map((h) => [h.type, h.amount]), [["withdrawal", -1000], ["deposit", 50000]]);
});

test("orders: who can trade, and bad input", async () => {
  await order(carol.token, "buy", 1, 100).expect(403); // no KYC
  await order(owner.token, "sell", 1, 100).expect(403); // owners use the primary sale
  await api().post("/trading/orders").send({ propertyId: property.id, side: "buy", shares: 1, price: 100 }).expect(401);
  await order(bob.token, "hold", 1, 100).expect(400);
  await order(bob.token, "buy", 1.5, 100).expect(400);
  await order(bob.token, "buy", 1, 100.001).expect(400);
  await order(bob.token, "buy", 1, 100, 99999).expect(404);
  await order(bob.token, "buy", 1000, 100).expect(409); // ₹1,00,000 but Bob has ₹49,000
  await order(bob.token, "sell", 1, 100).expect(409); // Bob has no shares
  await order(alice.token, "sell", 201, 100).expect(409); // Alice has 200
});

test("matching: best price first, then oldest; shares and money settle", async () => {
  const a1 = await order(alice.token, "sell", 50, 110).expect(201);
  const a2 = await order(alice.token, "sell", 50, 105).expect(201);
  assert.strictEqual(a1.body.trades.length, 0);

  // Alice can't sell her 100 other shares twice, and can't buy from herself.
  await order(alice.token, "sell", 101, 120).expect(409);
  const self = await order(alice.token, "buy", 1, 115).expect(409);
  assert.match(self.body.error, /your own order/);

  let book = (await api().get(`/market/${property.id}/orderbook`).expect(200)).body;
  assert.deepStrictEqual(book.asks, [{ price: 105, shares: 50, orders: 1 }, { price: 110, shares: 50, orders: 1 }]);

  // Bob buys 80 at up to ₹112: 50 at ₹105 (cheapest first), then 30 at ₹110.
  const b = await order(bob.token, "buy", 80, 112).expect(201);
  assert.strictEqual(b.body.order.status, "filled");
  assert.deepStrictEqual(b.body.trades.map((t) => [t.shares, t.price, t.status]), [[50, 105, "settling"], [30, 110, "settling"]]);
  assert.deepStrictEqual(b.body.trades.map((t) => t.orderId), [b.body.order.id, b.body.order.id]);

  // While the chain works, Bob's money is held, not spent.
  let w = await wallet(bob.token);
  assert.strictEqual(w.balance, 49000);
  assert.strictEqual(w.held, 8550);

  await trading.idle();
  const trades = (await api().get("/trading/trades").set(auth(bob.token)).expect(200)).body.trades;
  assert.ok(trades.every((t) => t.status === "settled" && t.side === "buy" && t.transaction));

  assert.strictEqual(await chain.balanceOf(property.contractAddress, bob.user.walletAddress), 80);
  assert.strictEqual(await chain.balanceOf(property.contractAddress, alice.user.walletAddress), 120);
  assert.deepStrictEqual(await wallet(bob.token), { balance: 40450, held: 0, available: 40450, currency: "INR" });
  assert.strictEqual((await wallet(alice.token)).balance, 8550);

  const mine = (await api().get(`/trading/orders/${a1.body.order.id}`).set(auth(alice.token)).expect(200)).body;
  assert.strictEqual(mine.order.filledShares, 30);
  assert.strictEqual(mine.order.remainingShares, 20);
  assert.strictEqual((await api().get(`/trading/orders/${a2.body.order.id}`).set(auth(alice.token))).body.order.status, "filled");
  await api().get(`/trading/orders/${a1.body.order.id}`).set(auth(bob.token)).expect(404);

  book = (await api().get(`/market/${property.id}/orderbook`).expect(200)).body;
  assert.deepStrictEqual(book, { propertyId: property.id, bids: [], asks: [{ price: 110, shares: 20, orders: 1 }] });

  // Two bids at the same price: the older one fills first. Trades use the bid's price.
  const first = await order(bob.token, "buy", 10, 100).expect(201);
  const second = await order(bob.token, "buy", 10, 100).expect(201);
  const s = await order(alice.token, "sell", 15, 99).expect(201);
  assert.deepStrictEqual(s.body.trades.map((t) => [t.shares, t.price]), [[10, 100], [5, 100]]);
  const { rows } = await db.query("SELECT buy_order_id FROM trades WHERE sell_order_id = $1 ORDER BY id", [s.body.order.id]);
  assert.deepStrictEqual(rows.map((r) => r.buy_order_id), [first.body.order.id, second.body.order.id]);
  await trading.idle();
  assert.strictEqual(await chain.balanceOf(property.contractAddress, bob.user.walletAddress), 95);
});

test("cancel an order and its held money comes back", async () => {
  const before = await wallet(bob.token);
  assert.strictEqual(before.held, 500); // 5 shares left at ₹100
  await api().post("/wallet/withdraw").set(auth(bob.token)).send({ amount: before.balance }).expect(409);

  const open = (await api().get("/trading/orders?status=open").set(auth(bob.token)).expect(200)).body.orders;
  assert.strictEqual(open.length, 1);
  await api().delete(`/trading/orders/${open[0].id}`).set(auth(alice.token)).expect(404);
  const c = await api().delete(`/trading/orders/${open[0].id}`).set(auth(bob.token)).expect(200);
  assert.strictEqual(c.body.order.status, "cancelled");
  await api().delete(`/trading/orders/${open[0].id}`).set(auth(bob.token)).expect(409);
  assert.strictEqual((await wallet(bob.token)).held, 0);
});

test("market data: price, 24h change, candles, portfolio", async () => {
  const m = (await api().get(`/market/${property.id}`).expect(200)).body;
  assert.strictEqual(m.ticker.lastPrice, 100);
  assert.strictEqual(m.ticker.change24h, 0); // listing price was ₹100
  assert.strictEqual(m.ticker.high24h, 110);
  assert.strictEqual(m.ticker.low24h, 100);
  assert.strictEqual(m.ticker.volume24h, 95);
  assert.strictEqual(m.ticker.marketCap, 100000);
  assert.strictEqual(m.ticker.bestAsk, 110);
  assert.strictEqual(m.ticker.bestBid, null);
  // Other investors can see how many shares are for sale.
  assert.ok(m.ticker.sharesForSale > 0);
  assert.strictEqual(m.ticker.sharesForSale, m.orderBook.asks.reduce((n, a) => n + a.shares, 0));
  assert.strictEqual(m.trades.length, 4);
  assert.strictEqual((await api().get("/market").expect(200)).body.markets.length, 1);

  const c = (await api().get(`/market/${property.id}/candles?interval=1d`).expect(200)).body.candles;
  assert.strictEqual(c[0].open, 105);
  assert.strictEqual(c.at(-1).close, 100);
  assert.strictEqual(Math.max(...c.map((x) => x.high)), 110);
  assert.strictEqual(Math.min(...c.map((x) => x.low)), 100);
  assert.strictEqual(c.reduce((sum, x) => sum + x.volume, 0), 95);
  assert.ok(c.every((x) => Number.isInteger(x.time) && x.time % 86400 === 0));
  await api().get(`/market/${property.id}/candles?interval=2h`).expect(400);
  await api().get("/market/99999").expect(404);

  // Bob's shares are valued at the last traded price.
  const p = (await api().get("/portfolio").set(auth(bob.token)).expect(200)).body;
  assert.strictEqual(p.holdings[0].shares, 95);
  assert.strictEqual(p.holdings[0].pricePerShare, 100);
  assert.strictEqual(p.holdings[0].invested, 10050); // 5,250 + 3,300 + 1,000 + 500

  const tx = (await api().get("/transactions").set(auth(bob.token)).expect(200)).body.transactions;
  assert.strictEqual(tx.length, 4);
  assert.ok(tx.every((t) => t.type === "buy" && t.tradeId));
});

test("freeze: no new orders, and a stuck trade goes through after unfreeze", async () => {
  await api().post(`/properties/${property.id}/freeze`).set(auth(laToken)).send({ reason: "Court case" }).expect(200);
  const res = await order(bob.token, "buy", 5, 110).expect(409);
  assert.match(res.body.error, /frozen/);

  // Pretend the freeze landed just after the check, so the match happens
  // but the chain refuses the transfer.
  const realRead = chain.readProperty;
  chain.readProperty = async (...args) => ({ ...(await realRead(...args)), frozen: false });
  let t;
  try {
    t = (await order(bob.token, "buy", 5, 110).expect(201)).body.trades[0];
  } finally {
    chain.readProperty = realRead;
  }
  await trading.idle();
  let trade = (await api().get("/trading/trades").set(auth(bob.token))).body.trades.find((x) => x.id === t.id);
  assert.strictEqual(trade.status, "failed");
  assert.match(trade.failureReason, /PropertyFrozen/);
  assert.strictEqual((await wallet(bob.token)).held, 550); // still held, not spent
  await api().post(`/trading/trades/${t.id}/retry`).set(auth(carol.token)).expect(404);

  // Unfreezing retries it automatically.
  await api().post(`/properties/${property.id}/unfreeze`).set(auth(laToken)).expect(200);
  await trading.idle();
  trade = (await api().get("/trading/trades").set(auth(bob.token))).body.trades.find((x) => x.id === t.id);
  assert.strictEqual(trade.status, "settled");
  assert.strictEqual(await chain.balanceOf(property.contractAddress, bob.user.walletAddress), 100);
  assert.strictEqual((await wallet(bob.token)).held, 0);
  await api().post(`/trading/trades/${t.id}/retry`).set(auth(bob.token)).expect(409);
  assert.strictEqual((await api().get("/admin/trades?status=settled").set(auth(adminToken)).expect(200)).body.trades.length, 5);
});

test("live updates over Socket.io", async () => {
  const server = app.listen(0);
  live.attach(server);
  const url = `http://localhost:${server.address().port}`;
  const watcher = connect(url, { transports: ["websocket"] });
  const bobSocket = connect(url, { transports: ["websocket"], auth: { token: bob.token } });
  try {
    await Promise.all([watcher, bobSocket].map((s) => new Promise((ok) => s.on("connect", ok))));
    watcher.emit("watch", property.id);
    await new Promise((ok) => setTimeout(ok, 200)); // let the server handle "watch"

    const next = (socket, event) => new Promise((ok) => socket.once(event, ok));
    const gotBook = next(watcher, "orderbook");
    const gotOrder = next(bobSocket, "order");
    const gotWallet = next(bobSocket, "wallet");
    await order(bob.token, "buy", 2, 90).expect(201);

    const book = await gotBook;
    assert.deepStrictEqual(book.bids, [{ price: 90, shares: 2, orders: 1 }]);
    assert.strictEqual((await gotOrder).status, "open");
    assert.strictEqual((await gotWallet).held, 180);

    // Alice sells into it: watchers see the trade, and the new price.
    const gotTrade = next(watcher, "trade");
    const gotTicker = next(watcher, "ticker");
    await order(alice.token, "sell", 2, 90).expect(201);
    assert.deepStrictEqual([(await gotTrade).shares, (await gotTrade).price], [2, 90]);
    assert.strictEqual((await gotTicker).lastPrice, 90);
    await trading.idle();
  } finally {
    watcher.close();
    bobSocket.close();
    live.close();
    server.close();
  }
});
