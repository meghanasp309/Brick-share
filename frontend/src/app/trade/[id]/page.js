"use client";
// The trading screen, like Zerodha or Groww: live chart, order book,
// latest trades, and a form to buy or sell shares with other investors.
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { getSocket } from "@/lib/live";
import { count, date, percent, rupees } from "@/lib/format";
import KycNotice from "@/components/KycNotice";
import OrderBook from "@/components/OrderBook";
import PriceChart from "@/components/PriceChart";
import { Alert, Button, Card, Field, FrozenBanner, Input, Loading, Page, Stat, StatusBadge, Table } from "@/components/ui";

const INTERVALS = ["1m", "5m", "15m", "1h", "1d"];

export default function TradePage() {
  const { id } = useParams();
  const propertyId = Number(id);
  const { user } = useAuth();
  const [ticker, setTicker] = useState(null);
  const [book, setBook] = useState(null);
  const [trades, setTrades] = useState([]);
  const [candles, setCandles] = useState([]);
  const [interval, setInterval_] = useState("5m");
  const [error, setError] = useState(null);
  const [pickedPrice, setPickedPrice] = useState(null);

  const loadCandles = useCallback(
    () => api(`/market/${propertyId}/candles?interval=${interval}`).then((r) => setCandles(r.candles)),
    [propertyId, interval]
  );

  // First load.
  useEffect(() => {
    api(`/market/${propertyId}`)
      .then((m) => {
        setTicker(m.ticker);
        setBook(m.orderBook);
        setTrades(m.trades);
      })
      .catch((err) => setError(err.message));
  }, [propertyId]);

  useEffect(() => {
    loadCandles().catch(() => {});
  }, [loadCandles]);

  // Live updates for this property.
  useEffect(() => {
    const socket = getSocket();
    const watch = () => socket.emit("watch", propertyId);
    watch();
    socket.on("connect", watch); // after a reconnect
    const onBook = (b) => b.propertyId === propertyId && setBook(b);
    const onTicker = (t) => t.propertyId === propertyId && setTicker(t);
    const onTrade = (t) => {
      if (t.propertyId !== propertyId) return;
      setTrades((list) => [t, ...list.filter((x) => x.id !== t.id)].slice(0, 20));
      loadCandles().catch(() => {});
    };
    socket.on("orderbook", onBook);
    socket.on("ticker", onTicker);
    socket.on("trade", onTrade);
    return () => {
      socket.emit("unwatch", propertyId);
      socket.off("connect", watch);
      socket.off("orderbook", onBook);
      socket.off("ticker", onTicker);
      socket.off("trade", onTrade);
    };
  }, [propertyId, loadCandles]);

  if (error) return <Page><Alert>{error}</Alert></Page>;
  if (!ticker) return <Loading />;
  const up = ticker.change24h > 0;
  const down = ticker.change24h < 0;

  return (
    <Page
      title={`${ticker.name}`}
      subtitle={
        <span>
          {ticker.symbol} · <Link href={`/properties/${propertyId}`} className="underline">Property details</Link>
          <span className="ml-2 inline-flex items-center gap-1 text-emerald-600">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> Live
          </span>
        </span>
      }
    >
      {ticker.frozen && <FrozenBanner />}
      <KycNotice user={user} />

      <Card className="mb-6">
        <div className="grid grid-cols-2 gap-6 md:grid-cols-6">
          <Stat
            label="Last price"
            value={rupees(ticker.lastPrice)}
            sub={`${up ? "+" : ""}${rupees(ticker.change24h)} (${percent(ticker.changePercent24h)})`}
            tone={up ? "up" : down ? "down" : undefined}
          />
          <Stat label="24h high" value={rupees(ticker.high24h)} />
          <Stat label="24h low" value={rupees(ticker.low24h)} />
          <Stat label="24h volume" value={count(ticker.volume24h)} sub="shares" />
          <Stat label="Best bid / ask" value={`${rupees(ticker.bestBid)}`} sub={`ask ${rupees(ticker.bestAsk)}`} />
          <Stat label="Market cap" value={rupees(ticker.marketCap)} />
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Card
            title="Price chart"
            actions={
              <div className="flex gap-1">
                {INTERVALS.map((i) => (
                  <button
                    key={i}
                    onClick={() => setInterval_(i)}
                    className={`rounded px-2 py-1 text-xs ${interval === i ? "bg-brand text-white" : "text-muted hover:bg-soft"}`}
                  >
                    {i}
                  </button>
                ))}
              </div>
            }
          >
            <PriceChart candles={candles} />
          </Card>
          {user?.role === "investor" && <MyOrders propertyId={propertyId} />}
          <Card title="Latest trades">
            <Table
              rows={trades}
              empty="No trades yet."
              columns={[
                { label: "Time", render: (t) => date(t.time) },
                { label: "Price", align: "right", render: (t) => rupees(t.price) },
                { label: "Shares", align: "right", render: (t) => count(t.shares) },
                { label: "Status", render: (t) => <StatusBadge status={t.status} /> },
              ]}
            />
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          {user?.role === "investor" ? (
            <OrderForm propertyId={propertyId} ticker={ticker} pickedPrice={pickedPrice} user={user} />
          ) : (
            <Card title="Buy or sell">
              <p className="text-sm text-muted">
                {user ? "Only investors can trade." : <><Link href="/login" className="underline">Log in</Link> as an investor to trade.</>}
              </p>
            </Card>
          )}
          <Card title="Order book">
            <OrderBook book={book} lastPrice={ticker.lastPrice} onPick={setPickedPrice} />
            <p className="mt-3 text-xs text-muted">Tap a price to use it in your order.</p>
          </Card>
        </div>
      </div>
    </Page>
  );
}

function OrderForm({ propertyId, ticker, pickedPrice, user }) {
  const [side, setSide] = useState("buy");
  const [shares, setShares] = useState(10);
  const [price, setPrice] = useState(ticker.lastPrice);
  const [wallet, setWallet] = useState(null);
  const [owned, setOwned] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  // A price picked from the order book fills the form.
  const [lastPicked, setLastPicked] = useState(pickedPrice);
  if (pickedPrice !== lastPicked) {
    setLastPicked(pickedPrice);
    if (pickedPrice) setPrice(pickedPrice);
  }

  const loadMine = useCallback(
    () =>
      Promise.all([api("/wallet"), api("/portfolio")]).then(([w, p]) => {
        setWallet(w.wallet);
        setOwned(p.holdings.find((h) => h.property.id === propertyId)?.shares || 0);
      }),
    [propertyId]
  );

  useEffect(() => {
    loadMine().catch(() => {});
    const socket = getSocket();
    const onWallet = (w) => setWallet(w);
    const onMyTrade = (t) => t.propertyId === propertyId && t.status === "settled" && loadMine().catch(() => {});
    socket.on("wallet", onWallet);
    socket.on("trade", onMyTrade);
    return () => {
      socket.off("wallet", onWallet);
      socket.off("trade", onMyTrade);
    };
  }, [loadMine, propertyId]);

  const total = (Number(shares) || 0) * (Number(price) || 0);
  const disabled = user.kycStatus !== "approved" || ticker.frozen;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const { order, trades } = await api("/trading/orders", {
        body: { propertyId, side, shares: Number(shares), price: Number(price) },
      });
      const matched = trades.reduce((n, t) => n + t.shares, 0);
      setMsg({
        tone: "success",
        text: matched
          ? `Matched ${matched} shares right away. ${order.remainingShares ? `${order.remainingShares} more are waiting on the book.` : ""} The blockchain is moving the shares now.`
          : "Your order is on the book. It trades when someone meets your price.",
      });
      loadMine().catch(() => {});
    } catch (err) {
      setMsg({ tone: "error", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Buy or sell">
      <div className="mb-4 grid grid-cols-2 rounded-lg bg-soft p-1 text-sm font-medium">
        {["buy", "sell"].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSide(s)}
            className={`rounded-md py-1.5 capitalize ${side === s ? (s === "buy" ? "bg-emerald-600 text-white" : "bg-red-600 text-white") : "text-muted"}`}
          >
            {s}
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Shares">
          <Input type="number" min={1} step={1} required value={shares} onChange={(e) => setShares(e.target.value)} />
        </Field>
        <Field label="Price per share (₹)" hint={side === "buy" ? "The most you will pay" : "The least you will accept"}>
          <Input type="number" min={0.01} step={0.01} required value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted">Total</span>
            <span className="font-semibold">{rupees(total)}</span>
          </div>
          <div className="flex justify-between text-xs text-muted">
            <span>{side === "buy" ? "Money you can use" : "Shares you own"}</span>
            <span>{side === "buy" ? rupees(wallet?.available) : count(owned)}</span>
          </div>
        </div>
        <Button type="submit" variant={side} busy={busy} disabled={disabled} className="w-full capitalize">
          {side} {ticker.symbol}
        </Button>
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        {side === "buy" && wallet && wallet.available < total && (
          <p className="text-xs text-muted">
            Not enough money? <Link href="/wallet" className="underline">Add money to your wallet</Link>.
          </p>
        )}
      </form>
    </Card>
  );
}

function MyOrders({ propertyId }) {
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState(null);

  const load = useCallback(
    () => api(`/trading/orders?propertyId=${propertyId}&status=open`).then((r) => setOrders(r.orders)),
    [propertyId]
  );

  useEffect(() => {
    load().catch(() => {});
    const socket = getSocket();
    const onOrder = (o) => o.propertyId === propertyId && load().catch(() => {});
    socket.on("order", onOrder);
    return () => socket.off("order", onOrder);
  }, [load, propertyId]);

  async function cancel(id) {
    setError(null);
    try {
      await api(`/trading/orders/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Card title="Your open orders">
      <Alert>{error}</Alert>
      <Table
        rows={orders}
        empty="You have no open orders here."
        columns={[
          { label: "Side", render: (o) => <span className={o.side === "buy" ? "text-emerald-600" : "text-red-600"}>{o.side}</span> },
          { label: "Price", align: "right", render: (o) => rupees(o.price) },
          { label: "Filled", align: "right", render: (o) => `${o.filledShares} / ${o.shares}` },
          { label: "Placed", render: (o) => date(o.createdAt) },
          { label: "", render: (o) => <Button variant="secondary" className="px-2! py-1! text-xs" onClick={() => cancel(o.id)}>Cancel</Button> },
        ]}
      />
    </Card>
  );
}
