// Payment signature checks. No database or blockchain needed.
process.env.RAZORPAY_KEY_ID = "";
process.env.RAZORPAY_KEY_SECRET = "";
const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const payments = require("../src/payments");

test("without Razorpay keys, payments are fake (mock mode)", async () => {
  assert.strictEqual(payments.mode(), "mock");
  assert.match(await payments.createOrder({ amountPaise: 100, receipt: "r1" }), /^mock_order_[0-9a-f]{16}$/);
});

test("accepts a signature made like Razorpay makes it", () => {
  // Razorpay: HMAC-SHA256 of "order_id|payment_id" with the secret key.
  const sig = crypto.createHmac("sha256", payments.MOCK_SECRET).update("order_1|pay_1").digest("hex");
  assert.strictEqual(payments.isValidSignature("order_1", "pay_1", sig), true);
});

test("rejects a wrong or missing signature", () => {
  const { razorpay_signature: sig } = payments.mockPayment("order_1");
  assert.strictEqual(payments.isValidSignature("order_1", "pay_other", sig), false);
  assert.strictEqual(payments.isValidSignature("order_1", "pay_1", "abc"), false);
  assert.strictEqual(payments.isValidSignature("order_1", "pay_1", undefined), false);
});

test("a fake payment passes the same check as a real one", () => {
  const p = payments.mockPayment("order_9");
  assert.strictEqual(payments.isValidSignature(p.razorpay_order_id, p.razorpay_payment_id, p.razorpay_signature), true);
});
