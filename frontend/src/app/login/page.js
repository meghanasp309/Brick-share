"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { homeFor, useAuth } from "@/lib/auth";
import { Alert, Button, Card, Field, Input, Page } from "@/components/ui";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token, user } = await api("/auth/login", { body: form });
      login(token, user);
      router.push(homeFor(user));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Page>
      <div className="mx-auto max-w-sm">
        <h1 className="mb-6 text-2xl font-semibold">Log in</h1>
        <Card>
          <form onSubmit={submit} className="space-y-4">
            <Field label="Email">
              <Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="Password">
              <Input type="password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </Field>
            <Alert>{error}</Alert>
            <Button type="submit" busy={busy} className="w-full">Log in</Button>
          </form>
        </Card>
        <p className="mt-4 text-center text-sm text-muted">
          New here? <Link href="/signup" className="text-brand underline">Create an account</Link>
        </p>
        <p className="mt-6 text-center text-xs text-muted">
          Test accounts: admin@brickshare.test / admin123 · land@brickshare.test / land123
        </p>
      </div>
    </Page>
  );
}
