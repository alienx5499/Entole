import { formatUsd, lte, type Money, min, sub, usd } from "@entole/shared-kernel";
import { type Mandate, shopsOf } from "./mandate.ts";
import type { BlockReason, ResolvedOffer, Verdict } from "./proposal.ts";

export const remaining = (m: Mandate): Money =>
  m.authorization ? sub(min(m.terms.budget, m.authorization.amount), m.captured) : usd(0);

const block = (reason: BlockReason, detail: string): Verdict => ({
  kind: "block",
  reasons: [reason],
  details: [detail],
});

const norm = (s: string) => s.trim().toLowerCase();

const attributesMatch = (
  required: Record<string, string>,
  actual: Record<string, string>,
): boolean => {
  const have = new Map(Object.entries(actual).map(([k, v]) => [norm(k), norm(v)]));
  return Object.entries(required).every(([k, v]) => have.get(norm(k)) === norm(v));
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Many listings (laptops, phones) have no variant options and state the spec only in the title,
// e.g. "24GB memory, 2TB storage". An option the offer does have always decides on its own.
// The required name and value pairs this offer does not meet.
const missingAttributes = (
  required: Record<string, string>,
  offer: ResolvedOffer,
): [string, string][] => {
  const have = new Map(Object.entries(offer.attributes).map(([k, v]) => [norm(k), norm(v)]));
  return Object.entries(required).filter(([k, v]) => {
    const actual = have.get(norm(k));
    if (actual !== undefined) return actual !== norm(v);
    const word = norm(v);
    return !(
      word !== "" &&
      new RegExp(`(^|[^a-z0-9])${escapeRegExp(word)}($|[^a-z0-9])`).test(norm(offer.title))
    );
  });
};

const optionsEqual = (a: Record<string, string>, b: Record<string, string>): boolean =>
  Object.keys(a).length === Object.keys(b).length && attributesMatch(a, b);

const bareHost = (h: string) => norm(h).replace(/^www\./, "");

// Channel3 sends every real offer through its own tracked redirect, which hides the destination.
const CATALOG_LINK_HOST = "buy.trychannel3.com";

// The link must be https and stay on the merchant's own domain or the catalog's redirect.
// Returns a detail when it does not.
const linkProblem = (offer: ResolvedOffer): string | null => {
  const merchant = bareHost(offer.merchant);
  let url: URL;
  try {
    url = new URL(offer.url);
  } catch {
    return `Link is not a valid address, expected ${merchant}`;
  }
  if (url.protocol !== "https:") return `Link is not https, expected ${merchant}`;
  const host = bareHost(url.hostname);
  return host === merchant || host.endsWith(`.${merchant}`) || host === CATALOG_LINK_HOST
    ? null
    : `Link goes to ${host}, not ${merchant}`;
};

export const checkProposal = (
  m: Mandate,
  offer: ResolvedOffer | null,
  now: Date,
  requested?: { productId: string; merchant: string; options: Record<string, string> },
): Verdict => {
  if (m.status === "awaiting_approval")
    return block("not_funded", "The mandate has not been approved and funded yet");
  if (m.status === "closed" || m.status === "exhausted")
    return block("closed", `The mandate is ${m.status}`);
  if (
    now.getTime() >= m.terms.validUntil.getTime() ||
    (m.authorization && now.getTime() >= m.authorization.expiresAt.getTime())
  )
    return block("expired", "The mandate or its PayPal hold has expired");
  if (!offer) return block("product_unavailable", "The product could not be found");

  const found: [BlockReason, string][] = [];
  const { allowedMerchants, maxUnitPrice, item } = m.terms;
  if (allowedMerchants.length > 0 && !allowedMerchants.includes(norm(offer.merchant)))
    found.push(["merchant_not_allowed", `Merchant ${offer.merchant} is not on your allowed list`]);
  if (!offer.inStock) found.push(["out_of_stock", `Out of stock at ${offer.merchant}`]);
  // An offer with no stated condition counts as new, as it does in Channel3's own search.
  if (offer.condition === "used") found.push(["not_new", `Listed as used at ${offer.merchant}`]);
  const link = linkProblem(offer);
  if (link !== null) found.push(["merchant_mismatch", link]);
  if (item.brands.length > 0 && !item.brands.some((b) => norm(b) === norm(offer.brand)))
    found.push([
      "wrong_brand",
      `Brand ${offer.brand || "unknown"} is not one of: ${item.brands.join(", ")}`,
    ]);
  const title = offer.title.toLowerCase();
  const hit = item.avoid.find((t) => norm(t) !== "" && title.includes(norm(t)));
  if (hit !== undefined) found.push(["avoided_term", `Title contains avoided term "${hit}"`]);
  if (
    requested &&
    m.terms.candidates.length > 0 &&
    !m.terms.candidates.some(
      (c) =>
        c.productId === requested.productId &&
        shopsOf(c).some((shop) => norm(shop) === norm(requested.merchant)) &&
        optionsEqual(c.options, requested.options),
    )
  )
    found.push(["not_a_candidate", "Not one of the items you signed"]);
  const missing = missingAttributes(item.requiredAttributes, offer);
  if (missing.length > 0)
    found.push([
      "wrong_attribute",
      `Not listed with ${missing.map(([k, v]) => `${k} ${v}`).join(", ")}`,
    ]);
  if (!lte(offer.price, maxUnitPrice))
    found.push([
      "over_unit_price",
      `Price $${formatUsd(offer.price)} is above your limit of $${formatUsd(maxUnitPrice)}`,
    ]);
  const left = remaining(m);
  if (!lte(offer.price, left))
    found.push([
      "over_budget",
      `Price $${formatUsd(offer.price)} is above the remaining budget of $${formatUsd(left)}`,
    ]);

  return found.length === 0
    ? { kind: "allow" }
    : { kind: "block", reasons: found.map(([r]) => r), details: found.map(([, d]) => d) };
};
