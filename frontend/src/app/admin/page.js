"use client";
// For BrickShare admins: check IDs (KYC), see users, fix stuck payments, and set platform rules.
import { useState } from "react";
import { api, openProtectedFile } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";
import { count, date, rupees, shortHash } from "@/lib/format";
import RequireLogin from "@/components/RequireLogin";
import { Alert, Badge, Button, Card, Field, Input, Loading, Page, StatusBadge, Table } from "@/components/ui";

export default function AdminPage() {
  return (
    <RequireLogin roles={["admin"]}>
      <Admin />
    </RequireLogin>
  );
}

const TABS = [["kyc", "KYC to check"], ["users", "Users"], ["stuck", "Stuck payments"], ["rules", "Rules"]];

function Admin() {
  const [tab, setTab] = useState("kyc");
  return (
    <Page title="Admin" subtitle="Approving an ID adds the person's wallet to every property's whitelist on the blockchain.">
      <div className="mb-6 flex gap-1 border-b border-line">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${tab === key ? "border-brand font-medium" : "border-transparent text-muted"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "kyc" && <KycQueue />}
      {tab === "users" && <Users />}
      {tab === "stuck" && <Stuck />}
      {tab === "rules" && <Rules />}
    </Page>
  );
}

function KycQueue() {
  const { data, error, loading, reload } = useLoad(() => api("/admin/kyc?status=pending"), []);
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);

  async function act(sub, action) {
    let body;
    if (action === "reject") {
      const note = window.prompt("Why is this ID rejected? The user will see this.");
      if (!note) return;
      body = { note };
    }
    setBusy(sub.id);
    setMsg(null);
    try {
      const r = await api(`/admin/kyc/${sub.id}/${action}`, { method: "POST", body });
      setMsg({
        tone: "success",
        text: action === "approve" ? `${sub.user.fullName} approved and whitelisted on ${r.whitelistedOn} properties.` : `${sub.user.fullName} rejected.`,
      });
      reload();
    } catch (err) {
      setMsg({ tone: "error", text: err.message });
    } finally {
      setBusy(null);
    }
  }

  async function view(sub) {
    try {
      await openProtectedFile(`/admin/kyc/${sub.id}/document`);
    } catch (err) {
      setMsg({ tone: "error", text: err.message });
    }
  }

  if (loading) return <Loading />;
  return (
    <Card>
      <Alert>{error}</Alert>
      {msg && <div className="mb-4"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      <Table
        rows={data?.submissions}
        empty="No IDs waiting. All done!"
        columns={[
          { label: "Person", render: (s) => <div><div className="font-medium">{s.user.fullName}</div><div className="text-xs text-muted">{s.user.email}</div></div> },
          { label: "Role", render: (s) => s.user.role },
          { label: "ID", render: (s) => <span className="capitalize">{s.idType} ···{s.idLast4}</span> },
          { label: "Sent", render: (s) => date(s.createdAt) },
          {
            label: "",
            render: (s) => (
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => view(s)}>View ID</Button>
                <Button variant="buy" busy={busy === s.id} onClick={() => act(s, "approve")}>Approve</Button>
                <Button variant="danger" disabled={busy === s.id} onClick={() => act(s, "reject")}>Reject</Button>
              </div>
            ),
          },
        ]}
      />
    </Card>
  );
}

function Users() {
  const { data, error, loading } = useLoad(() => api("/admin/users"), []);
  if (loading) return <Loading />;
  return (
    <Card>
      <Alert>{error}</Alert>
      <Table
        rows={data?.users}
        columns={[
          { label: "Name", render: (u) => u.fullName },
          { label: "Email", render: (u) => u.email },
          { label: "Role", render: (u) => <Badge>{u.role}</Badge> },
          { label: "KYC", render: (u) => <StatusBadge status={u.kycStatus} /> },
          { label: "Wallet", render: (u) => <code className="text-xs" title={u.walletAddress}>{shortHash(u.walletAddress)}</code> },
          { label: "Joined", render: (u) => date(u.createdAt) },
        ]}
      />
    </Card>
  );
}

// Orders, trades and rent that were paid but the blockchain refused (e.g. a freeze),
// or that got stuck half-way (e.g. the server stopped while sending the shares).
function Stuck() {
  const { data, error, loading, reload } = useLoad(async () => {
    const [failed, paid, trades, rent] = await Promise.all([
      api("/admin/orders?status=failed"), api("/admin/orders?status=paid"),
      api("/admin/trades?status=failed"), api("/rent?status=paid"),
    ]);
    return { orders: [...failed.orders, ...paid.orders], trades: trades.trades, payouts: rent.payouts };
  }, []);
  const [msg, setMsg] = useState(null);

  async function retry(path) {
    setMsg(null);
    try {
      await api(path, { method: "POST" });
      setMsg({ tone: "success", text: "Tried again. Check the status below." });
    } catch (err) {
      setMsg({ tone: "error", text: err.message });
    }
    reload();
  }

  if (loading) return <Loading />;
  const retryButton = (path) => <Button variant="secondary" onClick={() => retry(path)}>Try again</Button>;
  return (
    <div className="space-y-6">
      <Alert>{error}</Alert>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card title="First-sale orders">
        <Table
          rows={data?.orders}
          empty="None stuck."
          columns={[
            { label: "Order", render: (o) => `#${o.id}` },
            { label: "Property", render: (o) => o.property.name },
            { label: "Shares", align: "right", render: (o) => count(o.shares) },
            { label: "Amount", align: "right", render: (o) => rupees(o.amount) },
            { label: "Reason", render: (o) => o.failureReason || "Paid, but the shares were not sent yet" },
            { label: "", render: (o) => retryButton(`/orders/${o.id}/retry`) },
          ]}
        />
      </Card>
      <Card title="Trades">
        <Table
          rows={data?.trades}
          empty="None stuck."
          columns={[
            { label: "Trade", render: (t) => `#${t.id}` },
            { label: "Property", render: (t) => `#${t.propertyId}` },
            { label: "Shares", align: "right", render: (t) => count(t.shares) },
            { label: "Price", align: "right", render: (t) => rupees(t.price) },
            { label: "Reason", render: (t) => t.failureReason },
            { label: "", render: (t) => retryButton(`/trading/trades/${t.id}/retry`) },
          ]}
        />
      </Card>
      <Card title="Rent waiting to be shared out">
        <Table
          rows={data?.payouts}
          empty="None waiting."
          columns={[
            { label: "Payout", render: (r) => `#${r.id}` },
            { label: "Property", render: (r) => `#${r.propertyId}` },
            { label: "Amount", align: "right", render: (r) => rupees(r.amount) },
            { label: "Reason", render: (r) => r.failureReason || "–" },
            { label: "", render: (r) => retryButton(`/rent/${r.id}/retry`) },
          ]}
        />
      </Card>
    </div>
  );
}

// Max % per investor for the whole platform. Owners can only pick a lower limit.
function Rules() {
  const { data, error, loading, reload } = useLoad(() => api("/settings"), []);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await api("/admin/settings", { method: "PUT", body: { maxHoldingPercent: Number(value) } });
      setMsg({ tone: "success", text: `Saved. One investor can now own at most ${r.maxHoldingPercent}% of any property.` });
      setValue("");
      reload();
    } catch (err) {
      setMsg({ tone: "error", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading />;
  return (
    <Card title="Max % per investor">
      <Alert>{error}</Alert>
      <p className="mb-4 text-sm">
        Right now one investor can own at most <span className="font-semibold">{data?.maxHoldingPercent}%</span> of any property.
        Owners can set a lower limit for their own property, never a higher one.
      </p>
      <form onSubmit={save} className="flex flex-wrap items-end gap-3">
        <Field label="New limit (%)">
          <Input type="number" min={0.01} max={100} step={0.01} required value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <Button type="submit" busy={busy}>Save</Button>
      </form>
      <p className="mt-2 text-xs text-muted">People who already own more keep their shares, but can&apos;t buy more.</p>
      {msg && <div className="mt-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
    </Card>
  );
}
