"use client";
// For property owners: list a property, set its monthly rent, and add papers.
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { pay } from "@/lib/payments";
import { confirmDelete } from "@/lib/deleteProperty";
import { useLoad } from "@/lib/useLoad";
import { count, date, rupees } from "@/lib/format";
import AddDocument from "@/components/AddDocument";
import KycNotice from "@/components/KycNotice";
import RequireLogin from "@/components/RequireLogin";
import { Alert, Badge, Button, Card, Field, Input, Loading, Page, Select, StatusBadge, Table, inputClass } from "@/components/ui";

export default function OwnerPage() {
  return (
    <RequireLogin roles={["owner"]}>
      <Owner />
    </RequireLogin>
  );
}

function Owner() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useLoad(async () => {
    const [{ properties }, { payouts }, { schedules }, { wallet }] = await Promise.all([
      api("/properties"), api("/rent"), api("/rent-schedules"), api("/wallet"),
    ]);
    return { properties: properties.filter((p) => p.owner.id === user.id), payouts, schedules, wallet };
  }, [user.id]);
  const [showForm, setShowForm] = useState(false);

  if (loading) return <Loading />;
  const verified = user.kycStatus === "approved";

  return (
    <Page
      title="My properties"
      subtitle="List a property, then the Land Authority checks it and your shares are created on the blockchain."
      actions={verified && !showForm && <Button onClick={() => setShowForm(true)}>List a property</Button>}
    >
      <KycNotice user={user} />
      <Alert>{error}</Alert>
      {showForm && (
        <NewListing
          onCancel={() => setShowForm(false)}
          onDone={() => {
            setShowForm(false);
            reload();
          }}
        />
      )}
      <div className="space-y-6">
        {data?.properties.length === 0 && !showForm && (
          <Card><p className="py-6 text-center text-sm text-muted">You haven&apos;t listed a property yet.</p></Card>
        )}
        {data?.properties.map((p) => (
          <OwnedProperty
            key={p.id}
            p={p}
            schedule={data.schedules.find((s) => s.propertyId === p.id)}
            wallet={data.wallet}
            onDone={reload}
          />
        ))}
        {data?.payouts.length > 0 && (
          <Card title="Rent you paid">
            <Table
              rows={data.payouts}
              columns={[
                { label: "Property", render: (r) => data.properties.find((p) => p.id === r.propertyId)?.name || r.propertyId },
                { label: "Period", render: (r) => r.period || "–" },
                { label: "Amount", align: "right", render: (r) => rupees(r.amount) },
                { label: "Status", render: (r) => <StatusBadge status={r.status} /> },
                { label: "Date", render: (r) => date(r.createdAt) },
              ]}
            />
            <p className="mt-3 text-xs text-muted">&quot;paid&quot; means it is waiting to be shared out (for example, the property is frozen).</p>
          </Card>
        )}
      </div>
    </Page>
  );
}

function NewListing({ onCancel, onDone }) {
  const [form, setForm] = useState({ name: "", symbol: "", location: "", description: "", totalShares: 10000, pricePerShare: 100 });
  const [papers, setPapers] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      Object.entries(form).forEach(([k, v]) => body.append(k, v));
      if (papers) body.append("papers", papers);
      await api("/properties", { body });
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Card title="List a new property" className="mb-6">
      <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
        <Field label="Name"><Input required value={form.name} onChange={set("name")} placeholder="Green Valley Apartments" /></Field>
        <Field label="Short code" hint="2-10 letters or digits, like a stock ticker">
          <Input required value={form.symbol} onChange={set("symbol")} placeholder="GVA" maxLength={10} />
        </Field>
        <Field label="Location"><Input required value={form.location} onChange={set("location")} placeholder="Whitefield, Bengaluru" /></Field>
        <Field label="Papers (sale deed etc.)" hint="Saved on IPFS. Its fingerprint goes into the smart contract.">
          <Input type="file" onChange={(e) => setPapers(e.target.files[0])} />
        </Field>
        <Field label="Number of shares"><Input type="number" min={1} step={1} required value={form.totalShares} onChange={set("totalShares")} /></Field>
        <Field label="Price per share (₹)"><Input type="number" min={0.01} step={0.01} required value={form.pricePerShare} onChange={set("pricePerShare")} /></Field>
        <div className="md:col-span-2">
          <Field label="Description">
            <textarea className={inputClass} rows={3} value={form.description} onChange={set("description")} />
          </Field>
        </div>
        <div className="flex items-center gap-3 md:col-span-2">
          <Button type="submit" busy={busy}>List property</Button>
          <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
          <span className="text-sm text-muted">
            Property value: {rupees(Number(form.totalShares) * Number(form.pricePerShare))}
          </span>
        </div>
        <div className="md:col-span-2"><Alert>{error}</Alert></div>
      </form>
    </Card>
  );
}

function OwnedProperty({ p, schedule, wallet, onDone }) {
  const [panel, setPanel] = useState(null);
  const approved = p.status === "approved";
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  async function remove() {
    setDeleteError(null);
    if (!confirmDelete(p)) return;
    setDeleting(true);
    try {
      await api(`/properties/${p.id}`, { method: "DELETE" });
      onDone();
    } catch (err) {
      setDeleteError(err.message);
      setDeleting(false);
    }
  }

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          <Link href={`/properties/${p.id}`} className="hover:text-brand">{p.name}</Link>
          <Badge>{p.symbol}</Badge>
          <StatusBadge status={p.status} />
          {p.frozen && <Badge tone="red">Frozen: {p.freezeReason}</Badge>}
        </span>
      }
      actions={
        <div className="flex gap-2">
          {approved && (
            <>
              <Button variant="secondary" onClick={() => setPanel(panel === "rent" ? null : "rent")} disabled={p.frozen}>Pay once</Button>
              <Button variant="secondary" onClick={() => setPanel(panel === "doc" ? null : "doc")}>Add paper</Button>
            </>
          )}
          <Button variant="danger" busy={deleting} onClick={remove}>Delete</Button>
        </div>
      }
    >
      {deleteError && <div className="mb-3"><Alert>{deleteError}</Alert></div>}
      <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
        <div><span className="text-muted">Location:</span> {p.location}</div>
        <div><span className="text-muted">Shares:</span> {count(p.totalShares)}</div>
        <div><span className="text-muted">Price:</span> {rupees(p.pricePerShare)}</div>
        <div><span className="text-muted">Listed:</span> {date(p.createdAt)}</div>
      </div>
      {!approved && <p className="mt-3 text-sm text-muted">Waiting for the Land Authority to approve it.</p>}
      {approved && <MonthlyRent p={p} schedule={schedule} wallet={wallet} onDone={onDone} />}
      {panel === "rent" && <PayRent p={p} onDone={() => { setPanel(null); onDone(); }} />}
      {panel === "doc" && <AddDocument p={p} onDone={() => setPanel(null)} />}
    </Card>
  );
}

function PayRent({ p, onDone }) {
  const month = new Date().toLocaleString("en-IN", { month: "long", year: "numeric" });
  const [form, setForm] = useState({ amount: 100000, period: month });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const { payout, checkout } = await api(`/properties/${p.id}/rent`, { body: { amount: Number(form.amount), period: form.period } });
      const { payout: done } = await pay(checkout, `/rent/${payout.id}`);
      setMsg({
        tone: "success",
        text: done.status === "distributed" ? "Rent shared out to every shareholder." : "Paid. It will be shared out soon.",
      });
      setTimeout(onDone, 1500);
    } catch (err) {
      setMsg({ tone: "error", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 grid gap-4 border-t border-line pt-4 md:grid-cols-3">
      <Field label="Rent amount (₹)"><Input type="number" min={1} step={0.01} required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
      <Field label="For month"><Input value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} /></Field>
      <div className="flex items-end"><Button type="submit" busy={busy}>Pay and share out</Button></div>
      <p className="text-xs text-muted md:col-span-3">
        The smart contract takes a snapshot of who holds shares right now, and each holder gets their part in their wallet.
      </p>
      {msg && <div className="md:col-span-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
    </form>
  );
}

function MonthlyRent({ p, schedule, wallet, onDone }) {
  const [amount, setAmount] = useState(schedule?.amount || 20000);
  const [editing, setEditing] = useState(!schedule);
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const on = schedule?.active;

  async function run(what, fn) {
    setBusy(what);
    setMsg(null);
    try {
      const text = await fn();
      setMsg({ tone: "success", text });
      setEditing(false);
      onDone();
    } catch (err) {
      setMsg({ tone: "error", text: err.message });
    } finally {
      setBusy(null);
    }
  }

  const save = (active) =>
    run(active ? "save" : "stop", async () => {
      await api(`/properties/${p.id}/rent-schedule`, { method: "PUT", body: { amount: Number(amount), active } });
      return active ? "Monthly rent is on. This month's rent will be paid within a minute." : "Monthly rent stopped.";
    });

  const payNow = () =>
    run("now", async () => {
      const { payout } = await api(`/properties/${p.id}/rent-schedule/pay-now`, { method: "POST" });
      return payout.status === "distributed"
        ? `Rent for ${payout.period} shared out to every shareholder.`
        : "Paid. It will be shared out soon.";
    });

  return (
    <div className="mt-4 border-t border-line pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <span className="font-semibold">Monthly rent: </span>
          {on ? (
            <>
              {rupees(schedule.amount)} every {schedule.monthSeconds ? `${schedule.monthSeconds} seconds (demo)` : "month"}
              <span className="text-muted"> · next on {date(schedule.nextDueAt)}</span>
            </>
          ) : (
            <span className="text-muted">off</span>
          )}
        </div>
        <div className="flex gap-2">
          {on && <Button variant="secondary" busy={busy === "now"} disabled={p.frozen} onClick={payNow}>Pay next month now</Button>}
          {on && <Button variant="secondary" busy={busy === "stop"} onClick={() => save(false)}>Stop</Button>}
          {!editing && <Button variant="secondary" onClick={() => setEditing(true)}>{on ? "Change" : "Turn on"}</Button>}
        </div>
      </div>
      {editing && (
        <form onSubmit={(e) => { e.preventDefault(); save(true); }} className="mt-3 flex flex-wrap items-end gap-3">
          <Field label="Rent per month (₹)">
            <Input type="number" min={1} step={0.01} required value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Button type="submit" busy={busy === "save"}>Save</Button>
          {schedule && <Button type="button" variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>}
        </form>
      )}
      <p className="mt-2 text-xs text-muted">
        Each month the rent is taken from your <Link href="/wallet" className="underline">wallet</Link> (you have {rupees(wallet.available)})
        {" "}and shared out by shares held: someone with 10% of the shares gets 10% of the rent.
      </p>
      {on && schedule.lastError && <div className="mt-2"><Alert>{schedule.lastError}</Alert></div>}
      {msg && <div className="mt-2"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
    </div>
  );
}
