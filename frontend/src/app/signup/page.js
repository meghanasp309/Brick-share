"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Alert, Button, Card, Field, Input, Page } from "@/components/ui";

export default function SignupPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({ fullName: "", email: "", password: "", role: "investor" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token, user } = await api("/auth/signup", { body: form });
      login(token, user);
      router.push("/kyc");
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Page>
      <div className="mx-auto max-w-sm">
        <h1 className="mb-6 text-2xl font-semibold">Create an account</h1>
        <Card>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {[
                ["investor", "I want to invest", "Buy and trade shares"],
                ["owner", "I own property", "List it and sell shares"],
              ].map(([role, title, text]) => (
                <button
                  type="button"
                  key={role}
                  onClick={() => setForm({ ...form, role })}
                  className={`rounded-lg border p-3 text-left text-sm ${form.role === role ? "border-brand bg-soft" : "border-line"}`}
                >
                  <div className="font-medium">{title}</div>
                  <div className="text-xs text-muted">{text}</div>
                </button>
              ))}
            </div>
            <Field label="Full name">
              <Input required value={form.fullName} onChange={set("fullName")} />
            </Field>
            <Field label="Email">
              <Input type="email" required value={form.email} onChange={set("email")} />
            </Field>
            <Field label="Password" hint="At least 8 characters">
              <Input type="password" required minLength={8} value={form.password} onChange={set("password")} />
            </Field>
            <Alert>{error}</Alert>
            <Button type="submit" busy={busy} className="w-full">Sign up</Button>
            <p className="text-xs text-muted">
              We create a blockchain wallet for you and keep it safe. You never need to touch crypto.
            </p>
          </form>
        </Card>
        <p className="mt-4 text-center text-sm text-muted">
          Have an account? <Link href="/login" className="text-brand underline">Log in</Link>
        </p>
      </div>
    </Page>
  );
}
