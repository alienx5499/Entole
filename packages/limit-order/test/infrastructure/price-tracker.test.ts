import { describe, expect, test } from "bun:test";
import { usd } from "@entole/shared-kernel";
import { Channel3PriceTracker } from "../../src/index.ts";

// Shape recorded from a live call on 2026-10-26.
const historyFixture = {
  canonical_product_id: "4bTm76l",
  product_title: "On Cloud 6 Mens Running Shoes",
  history: [
    { timestamp: "2026-10-24T00:00:00Z", price: 160.0, currency: "USD" },
    { timestamp: "2026-10-25T00:00:00Z", price: 149.99, currency: "USD" },
  ],
  statistics: {},
};

const setup = (res: Response) => {
  const calls: { url: URL; method: string; headers: Record<string, string>; body?: unknown }[] = [];
  const stub = (async (url: string, init: RequestInit = {}) => {
    calls.push({
      url: new URL(url),
      method: init.method ?? "GET",
      headers: init.headers as Record<string, string>,
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    });
    return res;
  }) as unknown as typeof fetch;
  return { tracker: new Channel3PriceTracker({ apiKey: "fake-key", fetch: stub }), calls };
};

describe("Channel3PriceTracker", () => {
  test("start creates a product subscription for price and stock changes", async () => {
    const { tracker, calls } = setup(new Response("{}", { status: 200 }));
    await tracker.start("4bTm76l");
    expect(calls[0]?.url.pathname).toBe("/v1/product-subscriptions");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.headers["x-api-key"]).toBe("fake-key");
    expect(calls[0]?.body).toEqual({
      product_id: "4bTm76l",
      events: ["offer.price.changed", "offer.availability.changed"],
    });
  });

  test("start fails on any error status, including 409 (product still processing)", async () => {
    for (const status of [401, 404, 409])
      await expect(setup(new Response("{}", { status })).tracker.start("p")).rejects.toThrow(
        `status ${status}`,
      );
  });

  test("history requests the days window and maps points to Date and Money", async () => {
    const { tracker, calls } = setup(new Response(JSON.stringify(historyFixture)));
    const out = await tracker.history("4bTm76l", 30);
    expect(calls[0]?.url.pathname).toBe("/v0/price-tracking/history/4bTm76l");
    expect(calls[0]?.url.searchParams.get("days")).toBe("30");
    expect(out).toEqual([
      { at: new Date("2026-10-24T00:00:00Z"), price: usd(16000) },
      { at: new Date("2026-10-25T00:00:00Z"), price: usd(14999) },
    ]);
  });

  test("history throws on an error status", async () => {
    await expect(
      setup(new Response("{}", { status: 404 })).tracker.history("x", 7),
    ).rejects.toThrow("status 404");
  });
});
