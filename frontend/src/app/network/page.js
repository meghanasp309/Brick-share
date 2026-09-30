"use client";
// The live network view: the 4 blockchain nodes, and whether they agree.
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Badge, Card, Loading, Page } from "@/components/ui";

// Who runs each node, in simple words.
const ABOUT = {
  "BrickShare 1": "Run by BrickShare. The website talks to this one.",
  "BrickShare 2": "A second BrickShare server, as a backup.",
  "Property company": "Run by a property developer.",
  "Land Authority": "Run by the government land office. Only it can approve or freeze a property.",
};

const shortHash = (h) => (h ? `${h.slice(0, 10)}…${h.slice(-6)}` : "");

export default function NetworkPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    const load = () =>
      api("/network").then(
        (d) => active && (setData(d), setError(null)),
        (err) => active && setError(err.message)
      );
    load();
    const timer = setInterval(load, 2000); // a new block comes every 2 seconds
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const online = data?.nodes.filter((n) => n.online) || [];
  const hashes = new Set(online.map((n) => n.blockHash));
  const agree = online.length > 0 && hashes.size === 1;

  return (
    <Page
      title="Blockchain network"
      subtitle="Our private blockchain has 4 nodes. Each one keeps a full copy of who owns what. Updates every 2 seconds."
    >
      <Alert>{error}</Alert>
      {!data && !error && <Loading />}
      {data && (
        <>
          <div
            className={`mb-6 rounded-xl border px-5 py-4 text-sm ${
              data.healthy
                ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
                : "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
            }`}
          >
            <div className="font-semibold">
              {data.healthy
                ? `${data.online} of ${data.total} nodes online. The network is working.`
                : `Only ${data.online} of ${data.total} nodes online. New blocks stop until more come back.`}
            </div>
            <div>
              {agree
                ? `All online nodes have the same latest block (#${online[0].blockNumber}), so they agree on the record book.`
                : "Nodes are a block apart for a moment. This is normal: they catch up within seconds."}{" "}
              The nodes vote on every block (QBFT). It keeps going while at least 3 of the 4 are up.
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {data.nodes.map((n) => (
              <Card
                key={n.name}
                title={n.name}
                actions={n.online ? <Badge tone="green">online</Badge> : <Badge tone="red">offline</Badge>}
              >
                <p className="mb-4 text-sm text-muted">{ABOUT[n.name] || "A node of the BrickShare network."}</p>
                {n.online ? (
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <Item label="Latest block" value={`#${n.blockNumber}`} />
                    <Item label="Connected to" value={`${n.peers} other node${n.peers === 1 ? "" : "s"}`} />
                    <Item label="Block fingerprint" value={<span className="font-mono text-xs">{shortHash(n.blockHash)}</span>} />
                    <Item label="Transactions in it" value={n.transactions} />
                  </dl>
                ) : (
                  <p className="text-sm text-red-600">Can&apos;t reach this node. Is it running in Docker?</p>
                )}
              </Card>
            ))}
          </div>

          <p className="mt-6 text-sm text-muted">
            Try it: stop one node with <code className="rounded bg-soft px-1">docker stop land-authority</code>. The
            other 3 keep making blocks. Start it again with{" "}
            <code className="rounded bg-soft px-1">docker start land-authority</code> and it catches up.
          </p>
        </>
      )}
    </Page>
  );
}

function Item({ label, value }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 truncate font-medium">{value}</dd>
    </div>
  );
}
