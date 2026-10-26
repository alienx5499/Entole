import { describe, expect, test } from "bun:test";
import { usd } from "@entole/shared-kernel";
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
    { domain: "shoes.example", price: { price: 79.98 }, url: "https://shoes.example/p1?size=10" },
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
    });
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
});
