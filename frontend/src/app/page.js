"use client";
// Home: every property on the market, like a stock list.
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLoad } from "@/lib/useLoad";
import { count, percent, rupees } from "@/lib/format";
import { Alert, Badge, Card, Empty, LinkButton, Loading, Page } from "@/components/ui";

export default function Home() {
  const { user } = useAuth();
  const { data, error, loading } = useLoad(async () => {
    const [{ properties }, { markets }] = await Promise.all([api("/properties?status=approved"), api("/market")]);
    const byId = new Map(markets.map((m) => [m.propertyId, m]));
    return properties.map((p) => ({ ...p, market: byId.get(p.id) }));
  }, []);

  return (
    <>
      {!user && (
        <div className="border-b border-line bg-card">
          <div className="mx-auto max-w-6xl px-4 py-14">
            <h1 className="max-w-2xl text-4xl font-semibold tracking-tight">
              Own a small share of real property. Trade it like a stock.
            </h1>
            <p className="mt-4 max-w-2xl text-muted">
              Owners split a property into shares. Verified investors buy them with rupees, earn rent, and sell to each
              other any time. Who owns what is kept on a private blockchain run by BrickShare, property companies and
              the Land Authority.
            </p>
            <div className="mt-6 flex gap-3">
              <LinkButton href="/signup">Get started</LinkButton>
              <LinkButton href="/login" variant="secondary">Log in</LinkButton>
            </div>
          </div>
        </div>
      )}
      <Page title="Market" subtitle="Approved properties. Prices update with every trade.">
        {loading && <Loading />}
        <Alert>{error}</Alert>
        {data && !data.length && (
          <Card>
            <Empty>No properties yet. An owner lists one, and the Land Authority approves it.</Empty>
          </Card>
        )}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data?.map((p) => <PropertyCard key={p.id} p={p} />)}
        </div>
      </Page>
    </>
  );
}

function PropertyCard({ p }) {
  const m = p.market;
  const change = m?.changePercent24h ?? 0;
  return (
    <Link href={`/properties/${p.id}`} className="group rounded-xl border border-line bg-card p-5 transition hover:border-brand">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold group-hover:text-brand">{p.name}</div>
          <div className="text-sm text-muted">{p.location}</div>
        </div>
        <Badge>{p.symbol}</Badge>
      </div>
      {p.frozen && (
        <div className="mt-3">
          <Badge tone="red">Frozen: {p.freezeReason || "legal dispute"}</Badge>
        </div>
      )}
      <div className="mt-5 flex items-end justify-between">
        <div>
          <div className="text-xs text-muted">Price per share</div>
          <div className="text-2xl font-semibold">{rupees(m?.lastPrice ?? p.pricePerShare)}</div>
        </div>
        <div className={`text-sm font-medium ${change > 0 ? "text-emerald-600" : change < 0 ? "text-red-600" : "text-muted"}`}>
          {percent(change)} <span className="text-xs text-muted">24h</span>
        </div>
      </div>
      <div className="mt-3 text-xs">
        {m?.sharesForSale ? (
          <span className="font-medium text-emerald-700">
            {count(m.sharesForSale)} shares for sale by investors, from {rupees(m.bestAsk)}
          </span>
        ) : (
          <span className="text-muted">No investor is selling right now</span>
        )}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-line pt-3 text-xs text-muted">
        <span>Shares: {count(p.totalShares)}</span>
        <span className="text-right">Value: {rupees(m?.marketCap)}</span>
      </div>
    </Link>
  );
}
