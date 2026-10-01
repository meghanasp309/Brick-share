"use client";
// One property: details, the first sale from the owner, papers and rent.
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLoad } from "@/lib/useLoad";
import { pay } from "@/lib/payments";
import { count, date, rupees, shortHash } from "@/lib/format";
import Documents from "@/components/Documents";
import KycNotice from "@/components/KycNotice";
import {
  Alert, Badge, Button, Card, Empty, Field, FrozenBanner, Input, LinkButton, Loading, Page, Stat, StatusBadge, Table,
} from "@/components/ui";

export default function PropertyPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const { data, error, loading, reload } = useLoad(async () => {
    const [detail, market, docs, rent] = await Promise.all([
      api(`/properties/${id}`),
      api(`/market/${id}`).catch(() => null),
      api(`/properties/${id}/documents`).catch(() => ({ documents: [] })),
      api(`/properties/${id}/rent`).catch(() => ({ payouts: [] })),
    ]);
    return { ...detail, market, documents: docs.documents, payouts: rent.payouts };
  }, [id]);

  if (loading) return <Loading />;
  if (error) return <Page><Alert>{error}</Alert></Page>;

  const { property: p, onChain, sharesForSale, holdingLimit, market, documents, payouts } = data;
  const approved = p.status === "approved";
  const price = market?.ticker.lastPrice ?? p.pricePerShare;

  return (
    <Page
      title={p.name}
      subtitle={`${p.location} · ${p.symbol} · Listed by ${p.owner.fullName}`}
      actions={approved && <LinkButton href={`/trade/${p.id}`}>Trade on the market</LinkButton>}
    >
      {p.frozen && <FrozenBanner reason={p.freezeReason} />}
      {!approved && (
        <div className="mb-6">
          <Alert tone="info">Waiting for the Land Authority to check the papers and approve this property.</Alert>
        </div>
      )}
      <KycNotice user={user} />

      <Card className="mb-6">
        <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
          <Stat label="Market price" value={rupees(price)} sub={`Listed at ${rupees(p.pricePerShare)}`} />
          <Stat
            label="Total shares"
            value={count(p.totalShares)}
            sub={`One investor can own at most ${holdingLimit.percent}% (${count(holdingLimit.maxShares)})`}
          />
          <Stat label="Left from owner" value={count(sharesForSale)} sub={`at ${rupees(p.pricePerShare)} each`} />
          <Stat label="Property value" value={rupees(price * p.totalShares)} />
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          {p.description && (
            <Card title="About">
              <p className="whitespace-pre-line text-sm">{p.description}</p>
            </Card>
          )}
          <Documents documents={documents} />
          <Card title="Rent paid out">
            <Table
              rows={payouts}
              empty="No rent paid out yet."
              columns={[
                { label: "Period", render: (r) => r.period || "–" },
                { label: "Total rent", align: "right", render: (r) => rupees(r.amount) },
                { label: "Shared out", render: (r) => date(r.distributedAt) },
              ]}
            />
            <p className="mt-3 text-xs text-muted">Rent is split by how many shares each person held when it was paid.</p>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          {approved && user?.role === "investor" && (
            <BuyFromOwner p={p} sharesForSale={sharesForSale} holdingLimit={holdingLimit} user={user} onDone={reload} />
          )}
          {approved && <BuyFromInvestors p={p} market={market} />}
          <Card title="On the blockchain">
            <dl className="space-y-2 text-sm">
              <Row label="Status"><StatusBadge status={onChain.status} /></Row>
              <Row label="Frozen">{onChain.frozen ? <Badge tone="red">Yes</Badge> : "No"}</Row>
              <Row label="Shares issued">{count(onChain.sharesIssued)}</Row>
              <Row label="Owner holds">{count(onChain.ownerShares)}</Row>
              <Row label="Contract"><code className="text-xs">{shortHash(p.contractAddress)}</code></Row>
              <Row label="Reference">{p.ref}</Row>
            </dl>
            <p className="mt-3 text-xs text-muted">
              These numbers are read straight from the private blockchain, not from our database.
            </p>
          </Card>
        </div>
      </div>
    </Page>
  );
}

/** Shares other investors are selling on the market, with a way to buy them. */
function BuyFromInvestors({ p, market }) {
  const forSale = market?.ticker.sharesForSale || 0;
  return (
    <Card title="Buy from other investors">
      {forSale ? (
        <p className="mb-4 text-sm">
          <span className="font-semibold">{count(forSale)} shares</span> are for sale by other investors, from{" "}
          <span className="font-semibold">{rupees(market.ticker.bestAsk)}</span> each.
        </p>
      ) : (
        <p className="mb-4 text-sm text-muted">
          No investor is selling right now. You can still place a buy order, and it trades when someone sells at your price.
        </p>
      )}
      <LinkButton href={`/trade/${p.id}?side=buy`} variant="buy" className="w-full">
        Buy on the market
      </LinkButton>
    </Card>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function BuyFromOwner({ p, sharesForSale, holdingLimit, user, onDone }) {
  const [shares, setShares] = useState(10);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const n = Number(shares) || 0;
  const canBuy = user.kycStatus === "approved" && !p.frozen && sharesForSale > 0;

  async function buy(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const { order, checkout } = await api("/orders", { body: { propertyId: p.id, shares: n } });
      const { order: done } = await pay(checkout, `/orders/${order.id}`);
      setMsg(
        done.status === "completed"
          ? { tone: "success", text: `Done! ${done.shares} shares are now in your wallet on the blockchain.` }
          : { tone: "error", text: `Paid, but the shares didn't move yet: ${done.failureReason}. You can retry from your portfolio.` }
      );
      onDone();
    } catch (err) {
      setMsg({ tone: "error", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Buy from the owner">
      {sharesForSale === 0 ? (
        <Empty>
          All shares are sold. Buy from other investors on the <Link href={`/trade/${p.id}?side=buy`} className="underline">market</Link>.
        </Empty>
      ) : (
        <form onSubmit={buy} className="space-y-4">
          <Field
            label="Number of shares"
            hint={`${count(sharesForSale)} left at ${rupees(p.pricePerShare)} each. One investor can own at most ${count(holdingLimit.maxShares)} (${holdingLimit.percent}%).`}
          >
            <Input type="number" min={1} max={sharesForSale} step={1} required value={shares} onChange={(e) => setShares(e.target.value)} />
          </Field>
          <div className="flex justify-between text-sm">
            <span className="text-muted">You pay</span>
            <span className="font-semibold">{rupees(n * p.pricePerShare)}</span>
          </div>
          <Button type="submit" variant="buy" busy={busy} disabled={!canBuy || n < 1} className="w-full">
            Pay and buy
          </Button>
          {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
          <p className="text-xs text-muted">Test payment with Razorpay. No real money moves.</p>
        </form>
      )}
    </Card>
  );
}
