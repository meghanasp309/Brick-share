// Paying with Razorpay (test mode), or with fake payments when the
// backend has no Razorpay keys ("mock" mode).
import { api } from "./api";

function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = resolve;
    s.onerror = () => reject(new Error("Could not load Razorpay Checkout. Check your internet"));
    document.body.appendChild(s);
  });
}

/**
 * Finishes a payment the backend asked for.
 *  checkout: the "checkout" object the backend returned
 *  basePath: e.g. "/orders/12", "/wallet/deposits/3" or "/rent/5"
 * Resolves with the backend's answer after the payment is confirmed.
 */
export async function pay(checkout, basePath) {
  if (checkout.mode === "mock") return api(`${basePath}/mock-pay`, { method: "POST" });

  await loadRazorpay();
  return new Promise((resolve, reject) => {
    const rzp = new window.Razorpay({
      key: checkout.key,
      order_id: checkout.orderId,
      amount: checkout.amount,
      currency: checkout.currency,
      name: checkout.name,
      description: checkout.description,
      theme: { color: "#b45309" },
      handler: (proof) => api(`${basePath}/verify`, { body: proof }).then(resolve, reject),
      modal: { ondismiss: () => reject(new Error("Payment cancelled")) },
    });
    rzp.on("payment.failed", (r) => reject(new Error(r.error?.description || "Payment failed")));
    rzp.open();
  });
}
