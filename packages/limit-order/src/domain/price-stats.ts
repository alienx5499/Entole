import type { Money } from "@entole/shared-kernel";

export type PriceStats = {
  low: Money;
  high: Money;
  current: Money;
  // Whole percent the latest price sits above the window's low; null when the low is $0.
  aboveLowPercent: number | null;
};

// Summary of one product's recorded prices. The window is whatever the caller fetched
// (Entole asks Channel3 for 30 days); null when there is no point at all.
// No "today" range: Channel3 history is one point per day stamped at midnight UTC.
export const priceStats = (points: readonly { at: Date; price: Money }[]): PriceStats | null => {
  if (points.length === 0) return null;
  const cents = points.map((p) => p.price.cents);
  const low = points[cents.indexOf(Math.min(...cents))]?.price;
  const high = points[cents.indexOf(Math.max(...cents))]?.price;
  const current = points.reduce((a, b) => (b.at >= a.at ? b : a)).price;
  if (!low || !high) return null;
  return {
    low,
    high,
    current,
    aboveLowPercent:
      low.cents === 0 ? null : Math.round(((current.cents - low.cents) / low.cents) * 100),
  };
};
