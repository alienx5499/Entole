import { lte, type Money } from "@entole/shared-kernel";

// One Channel3 offer change for one product at one shop. `price` and `inStock` are null when the
// event does not carry them (an availability event may come without a price).
export type OfferEvent = {
  id: string;
  kind: "price" | "availability" | "created";
  productId: string;
  domain: string;
  price: Money | null;
  inStock: boolean | null;
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

// Only a trigger: the woken check re-quotes and runs checkProposal, so a false positive costs one
// quote and a missed event is still caught by the hourly tick.
export const shouldCheck = (m: WatchedMandate, e: OfferEvent): boolean => {
  if (m.status !== "funded" || m.terms.kind !== "limit") return false;
  if (!m.terms.candidates.some((c) => c.productId === e.productId && signedAt(c, e.domain)))
    return false;
  const atOrUnderLimit = e.price !== null && lte(e.price, m.terms.maxUnitPrice);
  switch (e.kind) {
    case "price":
    case "created":
      return atOrUnderLimit;
    case "availability":
      return e.inStock === true;
  }
};
