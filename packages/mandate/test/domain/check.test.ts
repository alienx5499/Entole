import { expect, test } from "bun:test";
import { usd } from "@entole/shared-kernel";
import {
  checkProposal,
  type Mandate,
  newMandate,
  type ResolvedOffer,
  remaining,
} from "../../src/index.ts";

const now = new Date("2026-10-26T00:00:00Z");
const base = newMandate({
  id: "m1",
  ownerId: "u1",
  now,
  terms: {
    kind: "standard",
    candidates: [],
    item: { query: "running shoes", requiredAttributes: { Size: "10" }, brands: [], avoid: [] },
    maxUnitPrice: usd(8000),
    budget: usd(8000),
    allowedMerchants: [],
    validUntil: new Date("2026-10-28T00:00:00Z"),
  },
});
const funded = (over: Partial<Mandate> = {}): Mandate => ({
  ...base,
  status: "funded",
  authorization: { id: "A1", amount: usd(8000), expiresAt: new Date("2026-11-24T00:00:00Z") },
  ...over,
});
const offer = (over: Partial<ResolvedOffer> = {}): ResolvedOffer => ({
  productId: "p1",
  title: "Shoe",
  merchant: "shoepalace.com",
  brand: "nike",
  price: usd(7998),
  attributes: { Size: "10" },
  url: "https://shoepalace.com/p1",
  inStock: true,
  condition: "new",
  ...over,
});
const reasons = (v: ReturnType<typeof checkProposal>) => (v.kind === "block" ? v.reasons : []);

test("price boundary", () => {
  expect(checkProposal(funded(), offer(), now).kind).toBe("allow");
  expect(checkProposal(funded(), offer({ price: usd(8000) }), now).kind).toBe("allow");
  expect(reasons(checkProposal(funded(), offer({ price: usd(8001) }), now))).toEqual([
    "over_unit_price",
    "over_budget",
  ]);
});
test("attributes", () => {
  expect(reasons(checkProposal(funded(), offer({ attributes: { Size: "11" } }), now))).toContain(
    "wrong_attribute",
  );
  expect(reasons(checkProposal(funded(), offer({ attributes: {} }), now))).toContain(
    "wrong_attribute",
  );
  expect(checkProposal(funded(), offer({ attributes: { " size ": "10 " } }), now).kind).toBe(
    "allow",
  );
});
test("a spec stated only in the title counts when the offer has no such option", () => {
  const laptop = funded({
    terms: {
      ...base.terms,
      item: { ...base.terms.item, requiredAttributes: { RAM: "24GB", Storage: "2TB" } },
    },
  });
  const titled = (title: string, attributes: Record<string, string> = {}) =>
    checkProposal(laptop, offer({ title, attributes }), now);
  expect(titled("MacBook Pro 16-inch, 24GB memory, 2TB storage").kind).toBe("allow");
  const wrongRam = titled("MacBook Pro 16-inch, 48GB memory, 2TB storage");
  expect(reasons(wrongRam)).toContain("wrong_attribute");
  expect(wrongRam.kind === "block" ? wrongRam.details : []).toContain("Not listed with RAM 24GB");
  // Whole words only: 12TB is not 2TB.
  expect(reasons(titled("MacBook Pro 24GB, 12TB"))).toContain("wrong_attribute");
  // A real option wins over the title.
  expect(reasons(titled("MacBook Pro 24GB 2TB", { Storage: "1TB" }))).toContain("wrong_attribute");
});
test("merchants", () => {
  const m = funded({ terms: { ...base.terms, allowedMerchants: ["shoepalace.com"] } });
  expect(
    reasons(
      checkProposal(
        m,
        offer({ merchant: "deals-unlimited.example", url: "https://deals-unlimited.example/p1" }),
        now,
      ),
    ),
  ).toEqual(["merchant_not_allowed"]);
  expect(checkProposal(m, offer({ merchant: "SHOEPALACE.com" }), now).kind).toBe("allow");
});
test("remaining budget", () => {
  const m = funded({ captured: usd(7200) });
  expect(remaining(m).cents).toBe(800);
  expect(reasons(checkProposal(m, offer({ price: usd(2000) }), now))).toEqual(["over_budget"]);
  expect(remaining(base).cents).toBe(0);
});
test("expiry", () => {
  expect(reasons(checkProposal(funded(), offer(), base.terms.validUntil))).toEqual(["expired"]);
  const m = funded({
    authorization: { id: "A1", amount: usd(8000), expiresAt: new Date("2026-10-27T00:00:00Z") },
  });
  expect(reasons(checkProposal(m, offer(), new Date("2026-10-27T00:00:00Z")))).toEqual(["expired"]);
});
test("status and missing product", () => {
  expect(reasons(checkProposal(base, offer(), now))).toEqual(["not_funded"]);
  expect(reasons(checkProposal(funded({ status: "closed" }), offer(), now))).toEqual(["closed"]);
  expect(reasons(checkProposal(funded({ status: "exhausted" }), offer(), now))).toEqual(["closed"]);
  expect(reasons(checkProposal(funded(), null, now))).toEqual(["product_unavailable"]);
});
test("only an in-stock offer that is not used can be bought", () => {
  const out = checkProposal(funded(), offer({ inStock: false }), now);
  expect(reasons(out)).toEqual(["out_of_stock"]);
  expect(out.kind === "block" && out.details[0]).toBe("Out of stock at shoepalace.com");
  const used = checkProposal(funded(), offer({ condition: "used" }), now);
  expect(reasons(used)).toEqual(["not_new"]);
  expect(used.kind === "block" && used.details[0]).toBe("Listed as used at shoepalace.com");
  // Channel3 counts an offer with no stated condition as new, and so does Entole.
  expect(checkProposal(funded(), offer({ condition: "unknown" }), now).kind).toBe("allow");
});
test("details", () => {
  const v = checkProposal(funded(), offer({ price: usd(14000) }), now);
  expect(v.kind === "block" && v.details[0]).toBe("Price $140.00 is above your limit of $80.00");
  expect(v.kind === "block" && v.details.length).toBe(v.kind === "block" ? v.reasons.length : -1);
});

const requested = { productId: "p1", merchant: "shoepalace.com", options: { Size: "10" } };
const cand = (over = {}) => ({
  ...requested,
  title: "Shoe",
  baselinePrice: usd(7998),
  ...over,
});
const withTerms = (t: Partial<typeof base.terms>) => funded({ terms: { ...base.terms, ...t } });

test("brands", () => {
  const m = withTerms({ item: { ...base.terms.item, brands: ["Nike"] } });
  const v = checkProposal(m, offer({ brand: "adidas" }), now);
  expect(reasons(v)).toEqual(["wrong_brand"]);
  expect(v.kind === "block" && v.details[0]).toBe("Brand adidas is not one of: Nike");
  expect(checkProposal(m, offer({ brand: "NIKE" }), now).kind).toBe("allow");
  expect(checkProposal(funded(), offer({ brand: "adidas" }), now).kind).toBe("allow");
});
test("avoided terms", () => {
  const m = withTerms({ item: { ...base.terms.item, avoid: ["white"] } });
  const v = checkProposal(m, offer({ title: "Pegasus White/Black" }), now);
  expect(reasons(v)).toEqual(["avoided_term"]);
  expect(v.kind === "block" && v.details[0]).toBe('Title contains avoided term "white"');
  expect(checkProposal(m, offer({ title: "Pegasus Black" }), now).kind).toBe("allow");
});
test("candidates", () => {
  const m = withTerms({ candidates: [cand()] });
  const v = checkProposal(m, offer(), now, { ...requested, productId: "p9" });
  expect(reasons(v)).toEqual(["not_a_candidate"]);
  expect(v.kind === "block" && v.details[0]).toBe("Not one of the items you signed");
  expect(checkProposal(m, offer(), now, { ...requested, options: { size: "10 " } }).kind).toBe(
    "allow",
  );
  expect(checkProposal(m, offer(), now, { ...requested, merchant: "other.com" }).kind).toBe(
    "block",
  );
  expect(checkProposal(m, offer(), now).kind).toBe("allow");
  expect(checkProposal(funded(), offer(), now, { ...requested, productId: "p9" }).kind).toBe(
    "allow",
  );
});

test("any signed shop of the same product and options passes; an unsigned shop does not", () => {
  const m = withTerms({ candidates: [{ ...cand(), merchants: ["shoepalace.com", "kicks.com"] }] });
  const kicks = offer({ merchant: "kicks.com", url: "https://kicks.com/p1" });
  expect(checkProposal(m, kicks, now, { ...requested, merchant: "Kicks.com" }).kind).toBe("allow");
  expect(checkProposal(m, offer(), now, requested).kind).toBe("allow");
  const other = offer({ merchant: "other.com", url: "https://other.com/p1" });
  expect(reasons(checkProposal(m, other, now, { ...requested, merchant: "other.com" }))).toEqual([
    "not_a_candidate",
  ]);
  // A signed shop does not widen the product or the options.
  expect(
    reasons(
      checkProposal(m, kicks, now, {
        ...requested,
        merchant: "kicks.com",
        options: { Size: "11" },
      }),
    ),
  ).toEqual(["not_a_candidate"]);
});

test("blank avoid terms are ignored", () => {
  const m = withTerms({ item: { ...base.terms.item, avoid: ["", "  "] } });
  expect(checkProposal(m, offer(), now).kind).toBe("allow");
});

test("the link must stay on the merchant's https domain", () => {
  const url = (u: string) => checkProposal(funded(), offer({ url: u }), now);
  expect(url("https://shoepalace.com/p1").kind).toBe("allow");
  expect(url("https://www.ShoePalace.com/p1").kind).toBe("allow");
  expect(url("https://shop.shoepalace.com/p1").kind).toBe("allow");
  // The catalog's tracked redirect is how real offers arrive.
  expect(url("https://buy.trychannel3.com/abc?o=1&aid=2").kind).toBe("allow");
  expect(reasons(url("https://buy.trychannel3.com.evil.example/abc"))).toEqual([
    "merchant_mismatch",
  ]);
  expect(reasons(url("http://shoepalace.com/p1"))).toEqual(["merchant_mismatch"]);
  expect(reasons(url("https://notshoepalace.com/p1"))).toEqual(["merchant_mismatch"]);
  const v = url("https://evil.example/p1");
  expect(reasons(v)).toEqual(["merchant_mismatch"]);
  expect(v.kind === "block" && v.details[0]).toBe("Link goes to evil.example, not shoepalace.com");
  expect(reasons(url("not a url"))).toEqual(["merchant_mismatch"]);
  expect(reasons(checkProposal(funded(), offer({ url: "" }), now))).toEqual(["merchant_mismatch"]);
});
