"use client";
// Candlestick price chart with volume bars (TradingView Lightweight Charts).
import { useEffect, useRef } from "react";
import { CandlestickSeries, HistogramSeries, createChart } from "lightweight-charts";

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export default function PriceChart({ candles }) {
  const box = useRef(null);
  const chart = useRef(null);

  // Build the chart once.
  useEffect(() => {
    const c = createChart(box.current, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: css("--muted") },
      grid: { vertLines: { color: css("--line") }, horzLines: { color: css("--line") } },
      rightPriceScale: { borderColor: css("--line") },
      timeScale: { borderColor: css("--line"), timeVisible: true },
      localization: { locale: "en-IN", priceFormatter: (p) => `₹${p.toFixed(2)}` },
    });
    const price = c.addSeries(CandlestickSeries, {
      upColor: "#059669", downColor: "#dc2626", borderVisible: false, wickUpColor: "#059669", wickDownColor: "#dc2626",
    });
    const volume = c.addSeries(HistogramSeries, {
      priceScaleId: "", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false,
    });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    chart.current = { c, price, volume };
    return () => {
      c.remove();
      chart.current = null;
    };
  }, []);

  // Draw new data whenever it changes.
  useEffect(() => {
    if (!chart.current) return;
    const { c, price, volume } = chart.current;
    price.setData(candles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    volume.setData(
      candles.map((k) => ({ time: k.time, value: k.volume, color: k.close >= k.open ? "#05966955" : "#dc262655" }))
    );
    c.timeScale().fitContent();
  }, [candles]);

  return (
    <div className="relative h-80 w-full">
      <div ref={box} className="absolute inset-0" />
      {!candles.length && (
        <div className="absolute inset-0 grid place-items-center text-sm text-muted">No trades yet. The chart starts with the first trade.</div>
      )}
    </div>
  );
}
