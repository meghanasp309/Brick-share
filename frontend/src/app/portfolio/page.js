"use client";
// Your shares, what they're worth, rent you earned, and your full history.
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLoad } from "@/lib/useLoad";
import { count, date, rupees, shortHash } from "@/lib/format";
import KycNotice from "@/components/KycNotice";
import { Alert, Badge, Button, Card, Loading, Page, Stat, StatusBadge, Table } from "@/components/ui";
import RequireLogin from "@/components/RequireLogin";

export default function PortfolioPage() {
  return (
    <RequireLogin roles={["investor", "owner"]}>
      <Portfolio />
    </RequireLogin>
  );
}

const typeLabel = { buy: "Bought", sell: "Sold", received: "Received", sent: "Sent", issued: "Issued" };

function Portfolio() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useLoad(async () => {
    const [portfolio, tx, rent, orders] = await Promise.all([
      api("/portfolio"), api("/transactions"), api("/rent/received"), api("/orders"),
    ]);
    return { ...portfolio, transactions: tx.transactions, rent, orders: orders.orders };
  }, []);

  if (loading) return <Loading />;
  if (error) return <Page title="Portfolio"><Alert>{error}</Alert></Page>;

  const { holdings, totals, transactions, rent, orders } = data;
  const gain = totals.value - totals.invested;
  const failed = orders.filter((o) => o.status === "failed");

  return (
    <Page title="Portfolio" subtitle="Share counts are read from the blockchain.">
      <KycNotice user={user} />
      {failed.length > 0 && <FailedOrders orders={failed} onDone={reload} />}

      <Card className="mb-6">
        <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
          <Stat label="Current value" value={rupees(totals.value)} />
          <Stat label="Invested" value={rupees(totals.invested)} />
          <Stat
            label="Gain / loss"
            value={`${gain >= 0 ? "+" : ""}${rupees(gain)}`}
            tone={gain > 0 ? "up" : gain < 0 ? "down" : undefined}
          />
          <Stat label="Rent earned" value={rupees(totals.rentEarned)} sub="paid into your wallet" />
        </div>
      </Card>

      <div className="space-y-6">
        <Card title="Your shares">
          <Table
            rows={holdings.map((h) => ({ ...h, id: h.property.id }))}
            empty="You don't own any shares yet. Pick a property on the Market page."
            columns={[
              {
                label: "Property",
                render: (h) => (
                  <Link href={`/properties/${h.property.id}`} className="font-medium hover:text-brand">
                    {h.property.name} {h.property.frozen && <Badge tone="red">Frozen</Badge>}
                  </Link>
                ),
              },
              { label: "Shares", align: "right", render: (h) => count(h.shares) },
              { label: "Own", align: "right", render: (h) => `${h.ownership}%` },
              { label: "Price", align: "right", render: (h) => rupees(h.pricePerShare) },
              { label: "Value", align: "right", render: (h) => rupees(h.value) },
              { label: "Rent earned", align: "right", render: (h) => rupees(h.rentEarned) },
              {
                label: "",
                render: (h) => (
                  <Link href={`/trade/${h.property.id}?side=sell`} className="text-sm text-brand underline">Sell</Link>
                ),
              },
            ]}
          />
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Rent received" actions={<span className="text-sm font-semibold">{rupees(rent.total)}</span>}>
            <Table
              rows={rent.received}
              empty="No rent yet. Each month the owner pays rent, and your part (by the shares you hold) lands in your wallet."
              columns={[
                { label: "Property", render: (r) => r.property.name },
                { label: "Period", render: (r) => r.period || "–" },
                { label: "Total rent", align: "right", render: (r) => rupees(r.totalRent) },
                { label: "Your part", align: "right", render: (r) => `${rupees(r.amount)} (${+((r.amount / r.totalRent) * 100).toFixed(2)}%)` },
                { label: "Date", render: (r) => date(r.createdAt) },
              ]}
            />
          </Card>
          <Card title="Share history (from the blockchain)">
            <Table
              rows={transactions.map((t) => ({ ...t, id: t.transaction + t.property.id }))}
              empty="No share movements yet."
              columns={[
                { label: "What", render: (t) => typeLabel[t.type] || t.type },
                { label: "Property", render: (t) => t.property.symbol },
                { label: "Shares", align: "right", render: (t) => count(t.shares) },
                { label: "Amount", align: "right", render: (t) => rupees(t.amount) },
                { label: "Block", render: (t) => <span title={t.transaction}>#{t.blockNumber} · {shortHash(t.transaction)}</span> },
              ]}
            />
          </Card>
        </div>
      </div>
    </Page>
  );
}

function FailedOrders({ orders, onDone }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  async function retry(id) {
    setBusy(id);
    setError(null);
    try {
      await api(`/orders/${id}/retry`, { method: "POST" });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <Card title="Paid, but shares not delivered yet" className="mb-6">
      <p className="mb-3 text-sm text-muted">
        You paid, but the blockchain refused the transfer (for example, the property was frozen). Your shares are kept for you.
      </p>
      <Alert>{error}</Alert>
      <Table
        rows={orders}
        columns={[
          { label: "Property", render: (o) => o.property.name },
          { label: "Shares", align: "right", render: (o) => count(o.shares) },
          { label: "Reason", render: (o) => o.failureReason },
          { label: "Status", render: (o) => <StatusBadge status={o.status} /> },
          { label: "", render: (o) => <Button variant="secondary" busy={busy === o.id} onClick={() => retry(o.id)}>Try again</Button> },
        ]}
      />
    </Card>
  );
}
