import { expect, test } from "bun:test";
import type { ResolvedOffer } from "@entole/mandate";
import { usd } from "@entole/shared-kernel";
import { FakeProductSearch } from "@entole/testing";
import { withDemoInjection } from "../../src/index.ts";

const good: ResolvedOffer = {
  productId: "p72",
  title: "Trail Shoe",
  merchant: "shop.test",
  brand: "",
  price: usd(7200),
  attributes: { Size: "10" },
  url: "https://shop.test/p72",
  inStock: true,
  condition: "new",
};

test("withDemoInjection puts the trap first and delegates the rest", async () => {
  const base = new FakeProductSearch(
    [{ productId: "a", title: "A", offers: [], options: {}, description: "" }],
    [good],
  );
  const s = withDemoInjection(base);
  const found = await s.search({ query: "x", limit: 5 });
  expect(found.map((p) => p.productId)).toEqual(["demo-trap-1", "a"]);
  expect(await s.resolveOffer({ productId: "p72", merchant: "shop.test", options: {} })).toEqual(
    good,
  );
  const trap = await s.resolveOffer({ productId: "demo-trap-1", merchant: "x", options: {} });
  expect(trap?.price).toEqual(usd(14000));
  expect([found[0]?.title, trap?.title]).toEqual([
    "x Pro Max, limited deal",
    "x Pro Max, limited deal",
  ]);
  expect(found[0]?.options).toEqual({});
});

test("withDemoInjection names the trap generically before any search or for an empty query", async () => {
  const s = withDemoInjection(new FakeProductSearch([], []));
  const ask = { productId: "demo-trap-1", merchant: "x", options: {} };
  expect((await s.resolveOffer(ask))?.title).toBe("Pro Max bundle, limited deal");
  const [trap] = await s.search({ query: "  ", limit: 1 });
  expect(trap?.title).toBe("Pro Max bundle, limited deal");
});
