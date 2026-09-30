"use client";
// For the Land Authority: approve new properties, and freeze or unfreeze them.
// These actions are signed with the Land Authority's own key on the blockchain.
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";
import { count, date, rupees } from "@/lib/format";
import AddDocument from "@/components/AddDocument";
import Documents from "@/components/Documents";
import RequireLogin from "@/components/RequireLogin";
import { Alert, Badge, Button, Card, Loading, Page, StatusBadge } from "@/components/ui";

export default function LandPage() {
  return (
    <RequireLogin roles={["land_authority"]}>
      <Land />
    </RequireLogin>
  );
}

function Land() {
  const { data, error, loading, reload } = useLoad(() => api("/properties"), []);
  // Shown at the top, because an approved property moves to the other list.
  const [notice, setNotice] = useState(null);
  const done = (text) => {
    setNotice(text);
    reload();
  };
  if (loading) return <Loading />;
  const pending = data?.properties.filter((p) => p.status === "pending") || [];
  const approved = data?.properties.filter((p) => p.status === "approved") || [];

  return (
    <Page
      title="Land Authority"
      subtitle="Your node signs these actions on the blockchain. Only you can approve or freeze a property. Not even BrickShare can."
    >
      <Alert>{error}</Alert>
      {notice && <div className="mb-6"><Alert tone="success">{notice}</Alert></div>}
      <h2 className="mb-3 font-semibold">Waiting for approval ({pending.length})</h2>
      <div className="mb-8 space-y-4">
        {!pending.length && <Card><p className="text-center text-sm text-muted">Nothing to check right now.</p></Card>}
        {pending.map((p) => <PropertyRow key={p.id} p={p} onDone={done} />)}
      </div>
      <h2 className="mb-3 font-semibold">Approved properties ({approved.length})</h2>
      <div className="space-y-4">
        {approved.map((p) => <PropertyRow key={p.id} p={p} onDone={done} />)}
      </div>
    </Page>
  );
}

const DONE_TEXT = {
  approve: "approved. All shares were created for the owner on the blockchain.",
  freeze: "frozen. No shares can move now.",
  unfreeze: "unfrozen. Trading is open again.",
};

function PropertyRow({ p, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);
  const docs = useLoad(() => (open ? api(`/properties/${p.id}/documents`) : Promise.resolve(null)), [open, p.id]);

  async function act(action) {
    let body;
    if (action === "freeze") {
      const reason = window.prompt("Why freeze it? (e.g. Legal dispute over ownership)");
      if (!reason) return;
      body = { reason };
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/properties/${p.id}/${action}`, { method: "POST", body });
      onDone(`${p.name}: ${DONE_TEXT[action]}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
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
          <Button variant="secondary" onClick={() => setOpen(!open)}>{open ? "Hide papers" : "Check papers"}</Button>
          {p.status === "pending" && <Button variant="buy" busy={busy} onClick={() => act("approve")}>Approve</Button>}
          {p.status === "approved" && !p.frozen && <Button variant="danger" busy={busy} onClick={() => act("freeze")}>Freeze</Button>}
          {p.frozen && <Button busy={busy} onClick={() => act("unfreeze")}>Unfreeze</Button>}
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
        <div><span className="text-muted">Owner:</span> {p.owner.fullName}</div>
        <div><span className="text-muted">Location:</span> {p.location}</div>
        <div><span className="text-muted">Shares:</span> {count(p.totalShares)} at {rupees(p.pricePerShare)}</div>
        <div><span className="text-muted">Listed:</span> {date(p.createdAt)}</div>
      </div>
      {error && <div className="mt-4"><Alert>{error}</Alert></div>}
      {open && (
        <div className="mt-4 space-y-4">
          {docs.data && <Documents documents={docs.data.documents} />}
          <AddDocument p={p} onDone={docs.reload} />
        </div>
      )}
    </Card>
  );
}
