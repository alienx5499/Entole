import { createHash } from "node:crypto";
import type { Money } from "@entole/shared-kernel";
import { usd } from "@entole/shared-kernel";

export type Candidate = {
  productId: string;
  merchant: string;
  // Every shop the buyer signed for this exact product and options, `merchant` first. Absent on
  // candidates built before shops were compared, which means `merchant` only.
  merchants?: string[];
  options: Record<string, string>;
  title: string;
  baselinePrice: Money;
};

export const MAX_SHOPS = 5;

export const shopsOf = (c: Candidate): string[] =>
  c.merchants && c.merchants.length > 0 ? c.merchants : [c.merchant];

// An item the shortlist turned down, with the check's reasons. Shown on the review page only:
// it is not part of the digest, so it never changes what the buyer signs.
export type RejectedCandidate = { title: string; merchant: string; details: string[] };

export const MAX_WINDOW_MS = 3 * 24 * 3600 * 1000;

const sortedEntries = (r: Record<string, string>) =>
  Object.fromEntries(
    Object.keys(r)
      .sort()
      .map((k) => [k, r[k]]),
  );

export type MandateTerms = {
  kind: "standard" | "limit";
  item: {
    query: string;
    requiredAttributes: Record<string, string>;
    brands: string[];
    avoid: string[];
  };
  candidates: Candidate[];
  maxUnitPrice: Money;
  budget: Money;
  allowedMerchants: string[];
  validUntil: Date;
};

// Where the buyer's PayPal account says to ship, read from the approved order.
export type ShipTo = {
  name: string;
  lines: string[];
  city: string;
  region: string;
  postalCode: string;
  country: string;
};

export type MandateStatus = "awaiting_approval" | "funded" | "exhausted" | "closed";

export type Mandate = {
  id: string;
  ownerId: string;
  createdAt: Date;
  terms: MandateTerms;
  digest: string;
  status: MandateStatus;
  authorization?: { id: string; amount: Money; expiresAt: Date };
  captured: Money;
  voided: boolean;
  demoInjection: boolean;
  // Replay buys at recorded history prices instead of live ones, so it is part of the digest.
  replay: boolean;
  rejected: RejectedCandidate[];
  // Failed PayPal void attempts on close; the watcher stops retrying at a cap.
  voidAttempts?: number;
  // Set once the capture was fully refunded; absent on rows written before refunds existed.
  refund?: { id: string; amount: Money };
  // From the PayPal approval; absent when the buyer's account has no address on file.
  shipTo?: ShipTo;
};

export const mandateDigest = (id: string, terms: MandateTerms, replay = false): string => {
  const lowerSorted = (xs: string[]) => xs.map((x) => x.toLowerCase()).sort();
  const canonical = JSON.stringify({
    v: 2,
    id,
    query: terms.item.query,
    requiredAttributes: sortedEntries(terms.item.requiredAttributes),
    brands: lowerSorted(terms.item.brands),
    avoid: lowerSorted(terms.item.avoid),
    kind: terms.kind,
    candidates: [...terms.candidates]
      .map((c) => ({
        productId: c.productId,
        merchant: c.merchant,
        // Only signed when there is more than one shop, so single-shop digests keep their bytes.
        ...(shopsOf(c).length > 1 ? { merchants: lowerSorted(shopsOf(c)) } : {}),
        options: sortedEntries(c.options),
        baselinePrice: c.baselinePrice.cents,
      }))
      .sort((a, b) => {
        const ka = JSON.stringify([a.productId, a.merchant, a.options]);
        const kb = JSON.stringify([b.productId, b.merchant, b.options]);
        return ka < kb ? -1 : ka > kb ? 1 : 0;
      }),
    maxUnitPrice: terms.maxUnitPrice.cents,
    budget: terms.budget.cents,
    allowedMerchants: [...terms.allowedMerchants].sort(),
    validUntil: terms.validUntil.toISOString(),
    replay,
  });
  return createHash("sha256").update(canonical).digest("hex");
};

export const newMandate = (input: {
  id: string;
  ownerId: string;
  now: Date;
  terms: MandateTerms;
  demoInjection?: boolean;
  replay?: boolean;
  rejected?: RejectedCandidate[];
}): Mandate => {
  const { id, ownerId, now } = input;
  const replay = input.replay ?? false;
  if (ownerId.trim() === "") throw new RangeError("A mandate needs an owner");
  const terms: MandateTerms = {
    ...input.terms,
    allowedMerchants: input.terms.allowedMerchants.map((d) => d.trim().toLowerCase()),
  };
  if (terms.budget.cents === 0) throw new RangeError("Budget must be above zero");
  if (terms.maxUnitPrice.cents > terms.budget.cents)
    throw new RangeError("Max unit price is above budget");
  if (terms.validUntil.getTime() <= now.getTime())
    throw new RangeError("validUntil must be in the future");
  if (terms.validUntil.getTime() - now.getTime() > MAX_WINDOW_MS)
    throw new RangeError("validUntil is more than 3 days away");
  if (terms.kind === "limit") {
    if (terms.maxUnitPrice.cents !== terms.budget.cents)
      throw new RangeError("A limit mandate needs maxUnitPrice equal to budget");
    if (terms.candidates.length < 1 || terms.candidates.length > 3)
      throw new RangeError("A limit mandate needs 1 to 3 candidates");
  }
  for (const c of terms.candidates) {
    const shops = shopsOf(c);
    if (shops.length > MAX_SHOPS)
      throw new RangeError(`A candidate allows at most ${MAX_SHOPS} shops`);
    if (shops[0]?.toLowerCase() !== c.merchant.toLowerCase())
      throw new RangeError("A candidate's first shop must be its merchant");
  }
  return {
    id,
    ownerId,
    createdAt: now,
    terms,
    digest: mandateDigest(id, terms, replay),
    status: "awaiting_approval",
    captured: usd(0),
    voided: false,
    demoInjection: input.demoInjection ?? false,
    replay,
    rejected: input.rejected ?? [],
  };
};
