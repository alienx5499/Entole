import { expect, test } from "bun:test";
import { usd } from "@entole/shared-kernel";
import { type MandateTerms, mandateDigest, newMandate } from "../../src/index.ts";

const now = new Date("2026-10-26T00:00:00Z");
const cand = (productId: string, cents = 7998) => ({
  productId,
  merchant: "shoepalace.com",
  options: { Size: "10" },
  title: "Shoe",
  baselinePrice: usd(cents),
});
const terms = (over: Partial<MandateTerms> = {}): MandateTerms => ({
  kind: "standard",
  candidates: [],
  item: { query: "running shoes", requiredAttributes: { Size: "10" }, brands: [], avoid: [] },
  maxUnitPrice: usd(8000),
  budget: usd(8000),
  allowedMerchants: [],
  validUntil: new Date("2026-10-28T00:00:00Z"),
  ...over,
});
const make = (t = terms()) => newMandate({ id: "m1", ownerId: "u1", now, terms: t });

test("new mandate state", () => {
  const m = make();
  expect(m.status).toBe("awaiting_approval");
  expect(m.captured.cents).toBe(0);
  expect(m.voided).toBe(false);
  expect(m.demoInjection).toBe(false);
  expect(m.replay).toBe(false);
  expect(m.ownerId).toBe("u1");
});
test("a mandate needs an owner", () => {
  expect(() => newMandate({ id: "m1", ownerId: " ", now, terms: terms() })).toThrow("owner");
});
test("digest is hex and stable, sensitive to price", () => {
  const m = make();
  expect(m.digest).toMatch(/^[0-9a-f]{64}$/);
  expect(mandateDigest("m1", terms())).toBe(m.digest);
  expect(mandateDigest("m1", terms({ maxUnitPrice: usd(7999) }))).not.toBe(m.digest);
});
test("replay is signed: it changes the digest and is stored on the mandate", () => {
  const r = newMandate({ id: "m1", ownerId: "u1", now, terms: terms(), replay: true });
  expect(r.replay).toBe(true);
  expect(r.digest).toBe(mandateDigest("m1", terms(), true));
  expect(r.digest).not.toBe(make().digest);
});
test("merchants normalised", () => {
  expect(make(terms({ allowedMerchants: [" ShoePalace.com "] })).terms.allowedMerchants).toEqual([
    "shoepalace.com",
  ]);
});
test("invalid terms throw", () => {
  expect(() => make(terms({ maxUnitPrice: usd(8001) }))).toThrow();
  expect(() => make(terms({ budget: usd(0), maxUnitPrice: usd(0) }))).toThrow();
  expect(() => make(terms({ validUntil: now }))).toThrow();
});

const limit = (n: number) =>
  terms({ kind: "limit", candidates: Array.from({ length: n }, (_, i) => cand(`p${i}`)) });
test("limit mandates", () => {
  expect(() => make(limit(1))).not.toThrow();
  expect(() => make(limit(3))).not.toThrow();
  expect(() => make(limit(0))).toThrow();
  expect(() => make(limit(4))).toThrow();
  expect(() => make({ ...limit(1), maxUnitPrice: usd(7999) })).toThrow();
});
test("window of 3 days", () => {
  const day3 = new Date(now.getTime() + 3 * 24 * 3600 * 1000);
  expect(() => make(terms({ validUntil: day3 }))).not.toThrow();
  expect(() => make(terms({ validUntil: new Date(day3.getTime() + 1) }))).toThrow();
});
test("digest covers v2 fields", () => {
  const a = terms({ candidates: [cand("p1"), cand("p2")] });
  const base = mandateDigest("m1", a);
  expect(mandateDigest("m1", terms({ candidates: [cand("p2"), cand("p1")] }))).toBe(base);
  expect(mandateDigest("m1", terms({ candidates: [cand("p1", 7000), cand("p2")] }))).not.toBe(base);
  expect(mandateDigest("m1", { ...a, kind: "limit" })).not.toBe(base);
  expect(mandateDigest("m1", { ...a, item: { ...a.item, avoid: ["x"] } })).not.toBe(base);
  expect(mandateDigest("m1", { ...a, item: { ...a.item, brands: ["nike"] } })).not.toBe(base);
});

test("duplicate productIds digest independent of order", () => {
  const a = { ...cand("p1"), merchant: "a.com" };
  const b = { ...cand("p1"), merchant: "b.com" };
  expect(mandateDigest("m1", terms({ candidates: [a, b] }))).toBe(
    mandateDigest("m1", terms({ candidates: [b, a] })),
  );
});

test("a one-shop candidate keeps the digest bytes signed before shops were compared", () => {
  const one = terms({ kind: "limit", candidates: [cand("p1")] });
  const pinned = "44939ef63473eed42130919d5191dbd064c793326a4432b5e6f30d959185f3fc";
  expect(mandateDigest("m1", one)).toBe(pinned);
  const listed = terms({
    kind: "limit",
    candidates: [{ ...cand("p1"), merchants: ["shoepalace.com"] }],
  });
  expect(mandateDigest("m1", listed)).toBe(pinned);
});

test("every signed shop is in the digest, independent of order and case", () => {
  const shops = (merchants: string[]) =>
    terms({ kind: "limit", candidates: [{ ...cand("p1"), merchants }] });
  const base = mandateDigest("m1", shops(["shoepalace.com", "a.com", "b.com"]));
  expect(mandateDigest("m1", shops(["shoepalace.com", "B.com", "a.com"]))).toBe(base);
  expect(mandateDigest("m1", shops(["shoepalace.com", "a.com"]))).not.toBe(base);
  expect(mandateDigest("m1", shops(["shoepalace.com"]))).not.toBe(base);
});

test("a candidate allows 1 to 5 shops, its merchant first", () => {
  const withShops = (merchants: string[]) =>
    make(terms({ kind: "limit", candidates: [{ ...cand("p1"), merchants }] }));
  expect(() => withShops(["ShoePalace.com", "a.com", "b.com", "c.com", "d.com"])).not.toThrow();
  expect(() => withShops(["shoepalace.com", "a.com", "b.com", "c.com", "d.com", "e.com"])).toThrow(
    "at most 5",
  );
  expect(() => withShops(["a.com", "shoepalace.com"])).toThrow("first shop");
});
