// The order book: people waiting to sell (asks, red) above people waiting to buy (bids, green).
import { count, rupees } from "@/lib/format";

function Level({ level, side, max, onPick }) {
  return (
    <button
      type="button"
      onClick={() => onPick?.(level.price, side)}
      title={side === "ask" ? "Buy at this price" : "Sell at this price"}
      className="relative grid w-full grid-cols-3 px-2 py-1 text-sm tabular-nums hover:bg-soft"
    >
      <span
        className={`absolute inset-y-0 right-0 ${side === "ask" ? "bg-red-500/10" : "bg-emerald-500/10"}`}
        style={{ width: `${(level.shares / max) * 100}%` }}
      />
      <span className={`relative text-left ${side === "ask" ? "text-red-600" : "text-emerald-600"}`}>{rupees(level.price)}</span>
      <span className="relative text-right">{count(level.shares)}</span>
      <span className="relative text-right text-muted">{level.orders}</span>
    </button>
  );
}

export default function OrderBook({ book, lastPrice, onPick }) {
  const asks = [...(book?.asks || [])].slice(0, 8).reverse(); // cheapest ask next to the middle
  const bids = (book?.bids || []).slice(0, 8);
  const max = Math.max(1, ...asks.map((a) => a.shares), ...bids.map((b) => b.shares));

  return (
    <div>
      <div className="grid grid-cols-3 px-2 pb-1 text-xs uppercase tracking-wide text-muted">
        <span>Price</span>
        <span className="text-right">Shares</span>
        <span className="text-right">Orders</span>
      </div>
      {asks.length ? (
        asks.map((a) => <Level key={`a${a.price}`} level={a} side="ask" max={max} onPick={onPick} />)
      ) : (
        <p className="px-2 py-2 text-xs text-muted">No one is selling.</p>
      )}
      <div className="my-1 border-y border-line px-2 py-2 text-center text-sm font-semibold">Last price {rupees(lastPrice)}</div>
      {bids.length ? (
        bids.map((b) => <Level key={`b${b.price}`} level={b} side="bid" max={max} onPick={onPick} />)
      ) : (
        <p className="px-2 py-2 text-xs text-muted">No one is buying.</p>
      )}
    </div>
  );
}
