// Small building blocks used on every screen.
import Link from "next/link";

export function Page({ title, subtitle, actions, children }) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      {(title || actions) && (
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            {title && <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>}
            {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

export function Card({ title, actions, children, className = "" }) {
  return (
    <section className={`min-w-0 rounded-xl border border-line bg-card p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex items-center justify-between gap-2">
          {title && <h2 className="font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

const buttonStyles = {
  primary: "bg-brand text-white hover:bg-brand-dark",
  secondary: "border border-line bg-card hover:bg-soft",
  danger: "bg-red-600 text-white hover:bg-red-700",
  buy: "bg-emerald-600 text-white hover:bg-emerald-700",
  sell: "bg-red-600 text-white hover:bg-red-700",
};

export function Button({ variant = "primary", busy, children, className = "", ...props }) {
  return (
    <button
      className={`inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${buttonStyles[variant]} ${className}`}
      disabled={busy || props.disabled}
      {...props}
    >
      {busy ? "Please wait…" : children}
    </button>
  );
}

export function LinkButton({ href, variant = "primary", children, className = "" }) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition ${buttonStyles[variant]} ${className}`}
    >
      {children}
    </Link>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-line bg-card px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";

export function Input({ className = "", ...props }) {
  return <input className={`${inputClass} ${className}`} {...props} />;
}

export function Select({ children, ...props }) {
  return (
    <select className={inputClass} {...props}>
      {children}
    </select>
  );
}

export function Alert({ tone = "error", children }) {
  if (!children) return null;
  const tones = {
    error: "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
    info: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200",
  };
  return <div className={`rounded-lg border px-4 py-3 text-sm ${tones[tone]}`}>{children}</div>;
}

const badgeTones = {
  green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  red: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  gray: "bg-soft text-muted",
  blue: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
};

export function Badge({ tone = "gray", children }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${badgeTones[tone]}`}>{children}</span>;
}

/** A colored badge for any status the backend sends. */
export function StatusBadge({ status }) {
  const tone =
    {
      approved: "green", completed: "green", settled: "green", distributed: "green", paid: "blue", filled: "green",
      pending: "amber", created: "amber", open: "blue", settling: "amber",
      rejected: "red", failed: "red", cancelled: "gray", expired: "gray", none: "gray",
    }[status] || "gray";
  return <Badge tone={tone}>{status}</Badge>;
}

export function Stat({ label, value, sub, tone }) {
  const color = tone === "up" ? "text-emerald-600" : tone === "down" ? "text-red-600" : "";
  return (
    <div className="min-w-0">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 break-words text-lg font-semibold md:text-xl ${color}`}>{value}</div>
      {sub && <div className={`text-xs ${color || "text-muted"}`}>{sub}</div>}
    </div>
  );
}

export function Empty({ children }) {
  return <p className="py-6 text-center text-sm text-muted">{children}</p>;
}

export function Loading() {
  return <p className="py-6 text-center text-sm text-muted">Loading…</p>;
}

/** A simple table. columns: [{ label, render(row), align }] */
export function Table({ columns, rows, empty = "Nothing here yet." }) {
  if (!rows?.length) return <Empty>{empty}</Empty>;
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full min-w-max text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
            {columns.map((c) => (
              <th key={c.label} className={`px-5 py-2 font-medium ${c.align === "right" ? "text-right" : ""}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id ?? i} className="border-b border-line last:border-0">
              {columns.map((c) => (
                <td key={c.label} className={`px-5 py-2 ${c.align === "right" ? "text-right tabular-nums" : ""}`}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FrozenBanner({ reason }) {
  return (
    <div className="mb-6 rounded-xl border border-red-300 bg-red-50 px-5 py-4 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
      <div className="font-semibold">Frozen by the Land Authority</div>
      <div className="text-sm">
        {reason || "Legal dispute"}. Nobody can buy, sell or move these shares until it is lifted. The blockchain itself
        blocks it.
      </div>
    </div>
  );
}
