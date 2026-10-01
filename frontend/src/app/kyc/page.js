"use client";
// KYC: upload an ID. An admin checks it, then your wallet may hold shares.
import { useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLoad } from "@/lib/useLoad";
import { date } from "@/lib/format";
import { ID_FORMATS, cleanIdNumber, idNumberError } from "@/lib/idFormats";
import RequireLogin from "@/components/RequireLogin";
import { Alert, Button, Card, Field, Input, Loading, Page, Select, StatusBadge } from "@/components/ui";

export default function KycPage() {
  return (
    <RequireLogin roles={["investor", "owner"]}>
      <Kyc />
    </RequireLogin>
  );
}

function Kyc() {
  const { refresh } = useAuth();
  const { data, error, loading, reload } = useLoad(() => api("/kyc"), []);
  const [form, setForm] = useState({ idType: "aadhaar", idNumber: "" });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [touched, setTouched] = useState(false);
  const idError = idNumberError(form.idType, form.idNumber);
  const showIdError = touched && form.idNumber && idError;
  const format = ID_FORMATS[form.idType];

  async function submit(e) {
    e.preventDefault();
    setTouched(true);
    if (idError) return;
    setBusy(true);
    setSendError(null);
    try {
      const body = new FormData();
      body.append("idType", form.idType);
      body.append("idNumber", cleanIdNumber(form.idNumber));
      body.append("document", file);
      await api("/kyc", { body });
      await Promise.all([reload(), refresh()]);
    } catch (err) {
      setSendError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading />;
  const status = data?.kycStatus;
  const sub = data?.submission;

  return (
    <Page title="Verify your ID (KYC)" subtitle="Only verified people can hold shares. The blockchain checks this too.">
      <Alert>{error}</Alert>
      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Your status" actions={<StatusBadge status={status} />}>
          {status === "approved" && (
            <Alert tone="success">You are verified. Your wallet is on every property&apos;s whitelist, so you can buy and trade.</Alert>
          )}
          {status === "pending" && <Alert tone="info">An admin is checking your ID. Come back soon.</Alert>}
          {status === "rejected" && <Alert>Rejected: {sub?.reviewNote || "no reason given"}. Please send it again.</Alert>}
          {status === "none" && <p className="text-sm text-muted">You haven&apos;t sent an ID yet.</p>}
          {sub && (
            <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
              <dt className="text-muted">ID</dt>
              <dd className="capitalize">{sub.idType} ending {sub.idLast4}</dd>
              <dt className="text-muted">Sent</dt>
              <dd>{date(sub.createdAt)}</dd>
              {sub.reviewedAt && (
                <>
                  <dt className="text-muted">Checked</dt>
                  <dd>{date(sub.reviewedAt)}</dd>
                </>
              )}
            </dl>
          )}
        </Card>

        {(status === "none" || status === "rejected") && (
          <Card title="Send your ID">
            <form onSubmit={submit} className="space-y-4">
              <Field label="ID type">
                <Select value={form.idType} onChange={(e) => { setForm({ idType: e.target.value, idNumber: "" }); setTouched(false); }}>
                  <option value="aadhaar">Aadhaar</option>
                  <option value="pan">PAN</option>
                  <option value="passport">Passport</option>
                </Select>
              </Field>
              <Field label="ID number" hint={`${format.hint}. We only show the last 4 characters later.`}>
                <Input
                  required
                  value={form.idNumber}
                  maxLength={format.maxLength}
                  placeholder={format.placeholder}
                  inputMode={form.idType === "aadhaar" ? "numeric" : "text"}
                  autoCapitalize="characters"
                  aria-invalid={showIdError ? true : undefined}
                  className={showIdError ? "!border-red-500" : ""}
                  onChange={(e) => setForm({ ...form, idNumber: form.idType === "aadhaar" ? e.target.value.replace(/[^\d ]/g, "") : e.target.value.toUpperCase() })}
                  onBlur={() => setTouched(true)}
                />
                {showIdError && <span className="mt-1 block text-xs text-red-600">{idError}</span>}
              </Field>
              <Field label="Photo or PDF of your ID" hint="Test project: any image works. It stays private and is not put on IPFS.">
                <Input type="file" required accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files[0])} />
              </Field>
              <Alert>{sendError}</Alert>
              <Button type="submit" busy={busy}>Send for review</Button>
            </form>
          </Card>
        )}
      </div>
    </Page>
  );
}
