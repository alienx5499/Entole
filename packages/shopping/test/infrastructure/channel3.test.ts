import { describe, expect, test } from "bun:test";
import { createMandate, fundMandate, proposeOrder } from "@entole/mandate";
import { usd } from "@entole/shared-kernel";
import {
  FakePaymentGateway,
  FixedClock,
  InMemoryMandateRepository,
  SequentialIds,
} from "@entole/testing";
import { Channel3Search } from "../../src/index.ts";

type Call = { url: URL; method: string; headers: Record<string, string>; body: unknown };
const setup = (res: () => Response) => {
  const calls: Call[] = [];
  const stub = (async (url: string, init: RequestInit = {}) => {
    calls.push({
      url: new URL(url),
      method: init.method ?? "GET",
      headers: init.headers as Record<string, string>,
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    });
    return res();
  }) as unknown as typeof fetch;
  return { search: new Channel3Search({ apiKey: "fake-key", fetch: stub }), calls };
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const searchBody = {
  products: [
    {
      id: "p1",
      title: "Road Runner",
      description: "Light shoe",
      offers: [
        {
          domain: "Shoes.example",
          price: { price: 79.98, currency: "USD" },
          url: "https://shoes.example/p1",
        },
      ],
      variants: { options: [{ name: "Size", values: [{ label: "9" }, { label: "10" }] }] },
    },
  ],
};
const productBody = {
  id: "p1",
  title: "Road Runner",
  offers: [
    {
      domain: "shoes.example",
      price: { price: 79.98 },
      url: "https://shoes.example/p1?size=10",
      availability: "InStock",
      condition: "new",
    },
  ],
  variants: { options: [], selected: [{ name: "Size", label: "10" }] },
};

describe("Channel3Search", () => {
  test("search posts the query and maps 79.98 dollars to 7998 cents", async () => {
    const { search, calls } = setup(() => json(searchBody));
    const out = await search.search({ query: "mens running shoes", maxPrice: usd(8000), limit: 5 });
    expect(calls[0]?.url.pathname).toBe("/v1/search");
    expect(calls[0]?.headers["x-api-key"]).toBe("fake-key");
    expect(calls[0]?.body).toEqual({
      query: "mens running shoes",
      filters: { price: { max_price: 80 } },
      limit: 5,
    });
    expect(out).toEqual([
      {
        productId: "p1",
        title: "Road Runner",
        description: "Light shoe",
        offers: [{ merchant: "Shoes.example", price: usd(7998) }],
        options: { Size: ["9", "10"] },
      },
    ]);
  });

  test("search accepts a data array", async () => {
    const { search } = setup(() => json({ data: searchBody.products }));
    expect(await search.search({ query: "x", limit: 1 })).toHaveLength(1);
  });

  test("search throws on an error status", async () => {
    const { search } = setup(() => json({}, 401));
    await expect(search.search({ query: "x", limit: 1 })).rejects.toThrow("status 401");
  });

  test("resolveOffer sends option_Size=10 and returns the merchant offer", async () => {
    const { search, calls } = setup(() => json(productBody));
    const offer = await search.resolveOffer({
      productId: "p1",
      merchant: "Shoes.Example",
      options: { Size: "10" },
    });
    expect(calls[0]?.url.pathname).toBe("/v1/products/p1");
    expect(calls[0]?.url.searchParams.get("option_Size")).toBe("10");
    expect(offer).toEqual({
      productId: "p1",
      title: "Road Runner",
      merchant: "shoes.example",
      brand: "",
      price: usd(7998),
      attributes: { Size: "10" },
      url: "https://shoes.example/p1?size=10",
      inStock: true,
      condition: "new",
    });
  });

  const shopOffers = (...offers: Record<string, unknown>[]) => ({
    ...productBody,
    offers: offers.map((o) => ({ ...productBody.offers[0], ...o })),
  });
  const askShop = (search: Channel3Search) =>
    search.resolveOffer({ productId: "p1", merchant: "shoes.example", options: {} });

  test("resolveOffer returns the shop's sold-out offer marked out of stock", async () => {
    const { search } = setup(() => json(shopOffers({ availability: "OutOfStock" })));
    expect(await askShop(search)).toMatchObject({ inStock: false, condition: "new" });
  });

  test("resolveOffer returns the shop's used offer marked used", async () => {
    const { search } = setup(() => json(shopOffers({ condition: "used" })));
    expect(await askShop(search)).toMatchObject({ inStock: true, condition: "used" });
  });

  test("resolveOffer picks the shop's cheapest in-stock new offer", async () => {
    const { search } = setup(() =>
      json(
        shopOffers({ price: { price: 90 } }, { price: { price: 70 } }, { price: { price: 80 } }),
      ),
    );
    expect((await askShop(search))?.price).toEqual(usd(7000));
  });

  test("a sold-out shop is refused as out of stock and nothing is captured", async () => {
    const { search } = setup(() => json(shopOffers({ availability: "OutOfStock" })));
    const gateway = new FakePaymentGateway();
    const deps = {
      repo: new InMemoryMandateRepository(),
      gateway,
      clock: new FixedClock(new Date("2026-10-26T00:00:00Z")),
      ids: new SequentialIds(),
      search,
    };
    const { mandate } = await createMandate(deps, {
      ownerId: "u1",
      terms: {
        kind: "standard",
        candidates: [],
        item: { query: "shoes", requiredAttributes: {}, brands: [], avoid: [] },
        maxUnitPrice: usd(8000),
        budget: usd(8000),
        allowedMerchants: [],
        validUntil: new Date("2026-10-27T00:00:00Z"),
      },
      demoInjection: false,
      baseUrl: "https://entole.test",
    });
    await fundMandate(deps, { mandateId: mandate.id, orderId: "order-1" });
    const r = await proposeOrder(deps, {
      mandateId: mandate.id,
      productId: "p1",
      merchant: "shoes.example",
      options: {},
      source: "agent",
    });
    expect(r.verdict.kind).toBe("block");
    expect(r.verdict.kind === "block" && r.verdict.reasons).toEqual(["out_of_stock"]);
    expect(gateway.captures).toHaveLength(0);
  });

  test("resolveOffer picks the shop's in-stock new offer over its used and sold-out ones", async () => {
    const { search } = setup(() =>
      json(
        shopOffers(
          { condition: "used", price: { price: 50 } },
          { availability: "OutOfStock", price: { price: 60 } },
          { price: { price: 79.98 } },
        ),
      ),
    );
    expect((await askShop(search))?.price).toEqual(usd(7998));
  });

  test("resolveOffer treats an offer with no stated condition as new", async () => {
    const { search } = setup(() => json(shopOffers({ condition: null })));
    expect((await askShop(search))?.condition).toBe("unknown");
  });

  test("resolveOffer fills brand from the first brand", async () => {
    const { search } = setup(() => json({ ...productBody, brands: [{ id: "o1qj", name: "On" }] }));
    const offer = await search.resolveOffer({
      productId: "p1",
      merchant: "shoes.example",
      options: {},
    });
    expect(offer?.brand).toBe("On");
  });

  test("resolveOffer returns null for an unknown merchant", async () => {
    const { search } = setup(() => json(productBody));
    expect(
      await search.resolveOffer({ productId: "p1", merchant: "other.example", options: {} }),
    ).toBeNull();
  });

  test("resolveOffer returns null on 404", async () => {
    const { search } = setup(() => json({}, 404));
    expect(
      await search.resolveOffer({ productId: "nope", merchant: "shoes.example", options: {} }),
    ).toBeNull();
  });

  test("concurrent shops of one product share one product request; a later call fetches again", async () => {
    const twoShops = {
      ...productBody,
      offers: [
        ...productBody.offers,
        { ...productBody.offers[0], domain: "b.example", price: { price: 75 }, url: "u" },
      ],
    };
    const { search, calls } = setup(() => json(twoShops));
    const ask = (merchant: string) =>
      search.resolveOffer({ productId: "p1", merchant, options: { Size: "10" } });
    const offers = await Promise.all([ask("shoes.example"), ask("b.example"), ask("c.example")]);
    expect(calls).toHaveLength(1);
    expect(offers.map((o) => o?.price ?? null)).toEqual([usd(7998), usd(7500), null]);
    await ask("shoes.example");
    expect(calls).toHaveLength(2);
  });

  test("different options are separate product requests", async () => {
    const { search, calls } = setup(() => json(productBody));
    await Promise.all([
      search.resolveOffer({ productId: "p1", merchant: "shoes.example", options: { Size: "9" } }),
      search.resolveOffer({ productId: "p1", merchant: "shoes.example", options: { Size: "10" } }),
    ]);
    expect(calls).toHaveLength(2);
  });

  test("a failed shared request is not kept", async () => {
    let status = 500;
    const { search, calls } = setup(() => json(productBody, status));
    const ask = () =>
      search.resolveOffer({ productId: "p1", merchant: "shoes.example", options: {} });
    await expect(Promise.all([ask(), ask()])).rejects.toThrow("status 500");
    expect(calls).toHaveLength(1);
    status = 200;
    expect(await ask()).not.toBeNull();
    expect(calls).toHaveLength(2);
  });
});
