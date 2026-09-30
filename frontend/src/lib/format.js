// Small helpers to show numbers and dates the Indian way.
const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const inrWhole = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const num = new Intl.NumberFormat("en-IN");

// Big amounts (1 lakh and up) are shown without paise, e.g. ₹11,00,000.
export const rupees = (n) =>
  n === null || n === undefined ? "–" : Math.abs(n) >= 100000 ? inrWhole.format(n) : inr.format(n);
export const count = (n) => (n === null || n === undefined ? "–" : num.format(n));
export const percent = (n) => (n === null || n === undefined ? "–" : `${n > 0 ? "+" : ""}${n.toFixed(2)}%`);
export const date = (d) => (d ? new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "–");
export const shortHash = (h) => (h ? `${h.slice(0, 8)}…${h.slice(-6)}` : "–");
