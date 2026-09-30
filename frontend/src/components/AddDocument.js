"use client";
// Upload one more paper for a property: it goes to IPFS and its CID into the contract.
import { useState } from "react";
import { api } from "@/lib/api";
import { Alert, Button, Field, Input, Select } from "./ui";

const KINDS = [
  ["sale-deed", "Sale deed"], ["title-report", "Title report"], ["tax-receipt", "Tax receipt"],
  ["rent-agreement", "Rent agreement"], ["valuation", "Valuation"], ["photo", "Photo"], ["other", "Other"],
];

export default function AddDocument({ p, onDone }) {
  const [kind, setKind] = useState("sale-deed");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const body = new FormData();
      body.append("kind", kind);
      body.append("document", file);
      await api(`/properties/${p.id}/documents`, { body });
      setMsg({ tone: "success", text: "Saved on IPFS, and its fingerprint is now on the blockchain." });
      setTimeout(onDone, 1500);
    } catch (err) {
      setMsg({ tone: "error", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 grid gap-4 border-t border-line pt-4 md:grid-cols-3">
      <Field label="Kind of paper">
        <Select value={kind} onChange={(e) => setKind(e.target.value)}>
          {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      </Field>
      <Field label="File"><Input type="file" required onChange={(e) => setFile(e.target.files[0])} /></Field>
      <div className="flex items-end"><Button type="submit" busy={busy}>Upload</Button></div>
      {msg && <div className="md:col-span-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
    </form>
  );
}
