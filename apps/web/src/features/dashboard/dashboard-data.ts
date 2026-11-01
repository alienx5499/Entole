import type { MandateOutcome, MandateView, PricesResponse } from "@/shared/api";
import { formatUsd } from "@/shared/ui/format-usd";
import { OUTCOME_LABEL } from "@/shared/ui/outcome-label";

// One row per limit order, flattened for the dashboard. Money is a number of dollars here.
export type OrderRow = {
  id: string;
  order: string;
  shop: string;
  product: string;
  outcome: string;
  outcomeKey: MandateOutcome;
  limit: number;
  paid: number;
  saved: number;
  held: number;
  /** The hold still reserved: only a watching order keeps money aside. */
  heldNow: number;
  /** Paid and kept: a refunded capture is not spent. */
  spent: number;
  isBought: number;
  isReleased: number;
  createdAt: string;
  validUntil: string;
};

export type PriceRow = {
  id: string;
  orderId: string;
  product: string;
  at: string;
  price: number;
  limit: number;
};

export type Kpis = {
  orders: number;
  held: number;
  spent: number;
  saved: number;
  bought: number;
  released: number;
};

const money = (s: string | undefined) => Number.parseFloat(s ?? "0") || 0;

export function toOrderRow(m: MandateView): OrderRow {
  const paid = money(m.captured);
  return {
    id: m.id,
    order: m.terms.query,
    shop: m.purchase?.merchant ?? m.candidates[0]?.merchant ?? "",
    product: m.purchase?.title ?? "",
    outcome: OUTCOME_LABEL[m.outcome],
    outcomeKey: m.outcome,
    limit: money(m.terms.limitPrice),
    paid,
    saved: m.outcome === "bought" ? money(m.purchase?.savings) : 0,
    held: money(m.held),
    heldNow: m.outcome === "watching" ? money(m.held) : 0,
    spent: m.outcome === "refunded" ? 0 : paid,
    isBought: m.outcome === "bought" ? 1 : 0,
    isReleased: m.outcome === "released" ? 1 : 0,
    createdAt: m.createdAt.slice(0, 10),
    validUntil: m.validUntil.slice(0, 10),
  };
}

/** Every candidate's price history; a replay only counts the points it has reached. */
export function toPriceRows(orderId: string, prices: PricesResponse): PriceRow[] {
  return prices.candidates.flatMap((c) => {
    const points = c.currentIndex === null ? c.points : c.points.slice(0, c.currentIndex + 1);
    return points.map((p, i) => ({
      id: `${orderId}:${c.productId}:${i}`,
      orderId,
      product: c.title,
      at: p.at,
      price: money(p.price),
      limit: money(c.limit),
    }));
  });
}

export function kpis(rows: OrderRow[]): Kpis {
  // Adds whole cents, so no float drift builds up across rows.
  const sum = (pick: (r: OrderRow) => number) =>
    rows.reduce((t, r) => t + Math.round(pick(r) * 100), 0) / 100;
  return {
    orders: rows.length,
    held: sum((r) => r.heldNow),
    spent: sum((r) => r.spent),
    saved: sum((r) => r.saved),
    bought: sum((r) => r.isBought),
    released: sum((r) => r.isReleased),
  };
}

/** Runs `fn` over `items` with at most `limit` calls in flight, keeping input order. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The savings explainer's answer, worked out from the rows alone. */
export function explainSavings(rows: OrderRow[]): string {
  const k = kpis(rows);
  if (k.orders === 0) return "You have no limit orders yet, so there is nothing saved.";
  const lines: string[] = [];
  const [top] = rows.filter((r) => r.isBought).sort((a, b) => b.saved - a.saved);
  if (!top) {
    lines.push(`None of your ${plural(k.orders, "order")} has bought yet, so nothing is saved.`);
  } else {
    lines.push(
      `You saved ${formatUsd(k.saved)} across ${plural(k.bought, "bought order")}, spending ${formatUsd(k.spent)}.`,
      "Savings is the gap between the item's usual price and what you paid; the agent can only buy at or under the limit you signed.",
      `Biggest win: "${top.order}" at ${top.shop || "the shop"}, paid ${formatUsd(top.paid)}, saved ${formatUsd(top.saved)}.`,
    );
  }
  if (k.released > 0) {
    lines.push(
      `${plural(k.released, "order")} ended without a match; those holds were released and cost nothing.`,
    );
  }
  if (k.held > 0) lines.push(`${formatUsd(k.held)} is still on hold for orders being watched.`);
  return lines.join("\n\n");
}
