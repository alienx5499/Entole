import { describe, expect, test } from "bun:test";
import { GroqKeyHealth } from "../../src/index.ts";

describe("GroqKeyHealth", () => {
  const setup = (statusFor: (key: string) => number | "throw") => {
    const seen: { url: string; key: string; method?: string }[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const stub = (async (url: string, init: RequestInit) => {
      const key = ((init.headers as Record<string, string>).Authorization ?? "").slice(7);
      seen.push({ url, key, method: init.method });
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Bun.sleep(5);
      inFlight--;
      const status = statusFor(key);
      if (status === "throw") throw new Error(`network down for ${key}`);
      return new Response(`{"error":"bad key ${key}"}`, { status });
    }) as unknown as typeof fetch;
    let t = 0;
    const health = new GroqKeyHealth({
      apiKeys: ["gsk_secret_one", "gsk_secret_two", "gsk_secret_three"],
      fetch: stub,
      now: () => t,
    });
    return { health, seen, peak: () => maxInFlight, at: (ms: number) => (t = ms) };
  };

  test("checks every key on the models list, in parallel, by slot", async () => {
    const { health, seen, peak } = setup((k) =>
      k === "gsk_secret_two" ? 401 : k === "gsk_secret_three" ? "throw" : 200,
    );
    const rows = await health.check();
    expect(rows.map(({ latencyMs: _, ...r }) => r)).toEqual([
      { slot: 1, ok: true, status: 200 },
      { slot: 2, ok: false, status: 401, error: "status 401" },
      { slot: 3, ok: false, status: 0, error: "network" },
    ]);
    for (const r of rows) expect(r.latencyMs).toBeGreaterThanOrEqual(0);
    expect(seen.every((s) => s.url === "https://api.groq.com/openai/v1/models")).toBe(true);
    expect(seen.every((s) => (s.method ?? "GET") === "GET")).toBe(true);
    expect(peak()).toBe(3);
    expect(JSON.stringify(rows)).not.toContain("gsk_");
  });

  test("keeps the result for 60 seconds", async () => {
    const { health, seen, at } = setup(() => 200);
    await health.check();
    at(59_999);
    await health.check();
    expect(seen).toHaveLength(3);
    at(60_000);
    await health.check();
    expect(seen).toHaveLength(6);
  });
});
