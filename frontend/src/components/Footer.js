"use client";
import Link from "next/link";
import { api } from "@/lib/api";
import { useEffect, useState } from "react";

// Shows the demo warning and whether the blockchain is running.
export default function Footer() {
  const [health, setHealth] = useState(null);

  useEffect(() => {
    let active = true;
    const check = () =>
      api("/health")
        .then((h) => active && setHealth(h))
        .catch(() => active && setHealth({ ok: false }));
    check();
    const timer = setInterval(check, 10_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <footer className="border-t border-line bg-card">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-muted">
        <span>
          <strong className="text-text">Demo project. Test money only.</strong> No real money or real property is involved.
        </span>
        {health && (
          <Link href="/network" className="flex items-center gap-2 hover:text-text">
            <span className={`h-2 w-2 rounded-full ${health.ok ? "bg-emerald-500" : "bg-red-500"}`} />
            {health.ok
              ? `Private blockchain running · block #${health.blockchain.blockNumber}`
              : "Can't reach the backend"}
          </Link>
        )}
      </div>
    </footer>
  );
}
