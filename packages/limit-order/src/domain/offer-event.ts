import { formatUsd, lte, type Money } from "@entole/shared-kernel";

// One Channel3 offer change for one product at one shop. `price` and `inStock` are null when the
// event does not carry them (an availability event may come without a price). `previousPrice` is
// only on a price change that reported one; `availability` is Channel3's own stock wording
// ("InStock", "OutOfStock", ...) when the event carries it.
export type OfferEvent = {
  id: string;
  kind: "price" | "availability" | "created";
  productId: string;
  domain: string;
  price: Money | null;
  previousPrice?: Money;
  inStock: boolean | null;
  availability?: string;
};

// The parts of a mandate the decision reads. A Mandate fits as is; the domain may not import
// @entole/mandate.
export type WatchedMandate = {
  status: string;
  terms: {
    kind: string;
    candidates: { productId: string; merchant: string; merchants?: string[] }[];
    maxUnitPrice: Money;
  };
};

// Every shop the buyer signed for a candidate; mirrors shopsOf in @entole/mandate.
const signedAt = (c: { merchant: string; merchants?: string[] }, domain: string): boolean =>
  (c.merchants?.length ? c.merchants : [c.merchant]).some(
    (shop) => shop.toLowerCase() === domain.toLowerCase(),
  );

// Why an event about an order's product and shop did not wake it.
export type NoteReason = "above_limit" | "out_of_stock" | "new_offer_above_limit";

// The audit kind of a note and the facts that make two notes the same news (event id and previous
// price left out), so the repeat check compares exactly what is written.
export const NOTE_KIND = "channel3_noted";

export const noteFacts = (e: OfferEvent): Record<string, string> => ({
  productId: e.productId,
  domain: e.domain,
  ...(e.price ? { price: formatUsd(e.price) } : {}),
  ...(e.availability !== undefined ? { availability: e.availability } : {}),
});

// A wake starts a check; a note is only recorded on the order; null means the event is not about
// this order or the order is not watching.
export type OfferEventVerdict = { kind: "wake" } | { kind: "note"; reason: NoteReason } | null;

// A wake is only a trigger: the woken check re-quotes and runs checkProposal, so a false positive
// costs one quote and a missed event is still caught by the hourly tick.
export const classifyOfferEvent = (m: WatchedMandate, e: OfferEvent): OfferEventVerdict => {
  if (m.status !== "funded" || m.terms.kind !== "limit") return null;
  if (!m.terms.candidates.some((c) => c.productId === e.productId && signedAt(c, e.domain)))
    return null;
  switch (e.kind) {
    case "price":
    case "created":
      if (e.price === null) return null;
      if (lte(e.price, m.terms.maxUnitPrice)) return { kind: "wake" };
      return { kind: "note", reason: e.kind === "price" ? "above_limit" : "new_offer_above_limit" };
    case "availability":
      if (e.inStock === null) return null;
      return e.inStock ? { kind: "wake" } : { kind: "note", reason: "out_of_stock" };
  }
};
