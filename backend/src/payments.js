// Payments with Razorpay in TEST mode (no real money moves).
//
// How a Razorpay payment works:
//  1. Our server creates an "order" at Razorpay for the amount.
//  2. The app opens Razorpay Checkout; the investor pays with a test card or UPI.
//  3. Razorpay gives the app three values: order id, payment id, and a signature.
//  4. Our server checks the signature with our secret key. Only Razorpay and we
//     know that key, so a valid signature proves the payment really happened.
//
// Without Razorpay keys we use "mock" mode: same steps, but the order is made
// up locally and the signature uses a fixed test secret.
const crypto = require("crypto");
const config = require("./config");
const { HttpError } = require("./errors");

const MOCK_SECRET = "brickshare-mock-payments";

const mode = () => (config.razorpay.keyId ? "razorpay" : "mock");
const secret = () => (mode() === "razorpay" ? config.razorpay.keySecret : MOCK_SECRET);

/** Creates a payment order for `amountPaise` and returns its id. */
async function createOrder({ amountPaise, receipt }) {
  if (mode() === "mock") return "mock_order_" + crypto.randomBytes(8).toString("hex");

  const { keyId, keySecret } = config.razorpay;
  let res;
  try {
    res = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic " + Buffer.from(`${keyId}:${keySecret}`).toString("base64"),
      },
      body: JSON.stringify({ amount: amountPaise, currency: "INR", receipt }),
    });
  } catch {
    throw new HttpError(503, "Can't reach Razorpay. Check your internet connection");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new HttpError(502, `Razorpay refused the order: ${body.error?.description || res.status}`);
  }
  return body.id;
}

/** The signature Razorpay sends back after a successful payment. */
const sign = (orderId, paymentId) =>
  crypto.createHmac("sha256", secret()).update(`${orderId}|${paymentId}`).digest("hex");

/** True if the signature proves this payment is real. */
function isValidSignature(orderId, paymentId, signature) {
  if (typeof signature !== "string") return false;
  const expected = Buffer.from(sign(orderId, paymentId));
  const given = Buffer.from(signature);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

/** Mock mode only: pretends the investor paid, and returns what Razorpay would. */
function mockPayment(orderId) {
  const paymentId = "mock_pay_" + crypto.randomBytes(8).toString("hex");
  return { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: sign(orderId, paymentId) };
}

module.exports = { mode, createOrder, isValidSignature, mockPayment, MOCK_SECRET };
