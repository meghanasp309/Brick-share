"use client";
// Shows the page only to logged-in users (optionally with certain roles).
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { Loading, Page, Alert } from "./ui";

const roleNames = { investor: "investors", owner: "property owners", admin: "admins", land_authority: "the Land Authority" };

export default function RequireLogin({ roles, children }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) {
    return (
      <Page title="Please log in">
        <p className="text-sm">
          You need to <Link href="/login" className="text-brand underline">log in</Link> to see this page.
        </p>
      </Page>
    );
  }
  if (roles && !roles.includes(user.role)) {
    return (
      <Page title="Not for your account">
        <Alert>This page is only for {roles.map((r) => roleNames[r]).join(" or ")}.</Alert>
      </Page>
    );
  }
  return children;
}
