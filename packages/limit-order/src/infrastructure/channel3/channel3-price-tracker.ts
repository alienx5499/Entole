import { parseUsd } from "@entole/shared-kernel";
import type { PriceTracker } from "../../application/ports.ts";

// A hung upstream call must not hold a mandate lock or a request forever.
const TIMEOUT_MS = 15_000;

const BASE_URL = "https://api.trychannel3.com";

type Config = { apiKey: string; fetch?: typeof fetch };
export class PriceTrackingError extends Error {
  constructor(readonly status: number) {
    super(`Channel3 price tracking request failed: status ${status}`);
    this.name = "PriceTrackingError";
  }
}

type HistoryBody = { history?: { timestamp: string; price: number; currency?: string }[] };

export class Channel3PriceTracker implements PriceTracker {
  private readonly http: typeof fetch;

  constructor(private readonly cfg: Config) {
    this.http = cfg.fetch ?? fetch;
  }

  async start(productId: string): Promise<void> {
    const res = await this.http(`${BASE_URL}/v0/price-tracking/start`, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "x-api-key": this.cfg.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ canonical_product_id: productId }),
    });
    // 2xx is success; 409 means the product is already tracked.
    if (!res.ok && res.status !== 409) throw new PriceTrackingError(res.status);
  }

  async history(productId: string, days: number) {
    // The live API takes the id in the path (the query-param form returns 404).
    const res = await this.http(
      `${BASE_URL}/v0/price-tracking/history/${encodeURIComponent(productId)}?days=${days}`,
      { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "x-api-key": this.cfg.apiKey } },
    );
    if (!res.ok) throw new PriceTrackingError(res.status);
    const body = (await res.json()) as HistoryBody;
    return (body.history ?? []).map((p) => ({
      at: new Date(p.timestamp),
      price: parseUsd(p.price.toFixed(2)),
    }));
  }
}
