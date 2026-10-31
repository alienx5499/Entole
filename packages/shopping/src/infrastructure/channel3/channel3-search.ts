import type { ProductSearch, ProductSummary, ResolvedOffer } from "@entole/mandate";
import { formatUsd, usdFromDollars } from "@entole/shared-kernel";

// A hung upstream call must not hold a mandate lock or a request forever.
const TIMEOUT_MS = 15_000;

const BASE_URL = "https://api.trychannel3.com";

type Config = { apiKey: string; fetch?: typeof fetch };

type Channel3Offer = {
  domain: string;
  price: { price: number };
  url: string;
  availability?: "InStock" | "OutOfStock";
  condition?: "new" | "used" | null;
};
type Channel3Product = {
  id: string;
  title: string;
  description?: string;
  brands?: { name: string }[];
  offers?: Channel3Offer[];
  variants?: {
    options?: { name: string; values: { label: string }[] }[];
    selected?: { name: string; label: string }[];
  };
};

export class Channel3Error extends Error {
  constructor(readonly status: number) {
    super(`Channel3 request failed: status ${status}`);
    this.name = "Channel3Error";
  }
}

export class Channel3Search implements ProductSearch {
  private readonly http: typeof fetch;
  // Concurrent lookups of one product (one per shop) share a single request. Not a cache: the entry
  // is dropped once settled, so a later call (e.g. the capture-time re-quote) always fetches fresh.
  private readonly inFlight = new Map<string, Promise<Channel3Product | null>>();

  constructor(private readonly cfg: Config) {
    this.http = cfg.fetch ?? fetch;
  }

  async search(q: Parameters<ProductSearch["search"]>[0]): Promise<ProductSummary[]> {
    const res = await this.http(`${BASE_URL}/v1/search`, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "x-api-key": this.cfg.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: q.query,
        ...(q.maxPrice ? { filters: { price: { max_price: Number(formatUsd(q.maxPrice)) } } } : {}),
        limit: q.limit,
      }),
    });
    if (!res.ok) throw new Channel3Error(res.status);
    const body = (await res.json()) as { products?: Channel3Product[]; data?: Channel3Product[] };
    return (body.products ?? body.data ?? []).map((p) => ({
      productId: p.id,
      title: p.title,
      description: p.description ?? "",
      offers: (p.offers ?? []).map((o) => ({
        merchant: o.domain,
        price: usdFromDollars(o.price.price),
      })),
      options: Object.fromEntries(
        (p.variants?.options ?? []).map((o) => [o.name, o.values.map((v) => v.label)]),
      ),
    }));
  }

  async resolveOffer(
    i: Parameters<ProductSearch["resolveOffer"]>[0],
  ): Promise<ResolvedOffer | null> {
    const params = new URLSearchParams(
      Object.entries(i.options).map(([k, v]): [string, string] => [`option_${k}`, v]),
    );
    const qs = params.size > 0 ? `?${params}` : "";
    const p = await this.product(i.productId, qs);
    if (!p) return null;
    const shop = (p.offers ?? []).filter(
      (o) => o.domain.toLowerCase() === i.merchant.toLowerCase(),
    );
    // A shop can list several offers: buy its cheapest in-stock non-used one. Failing that, return
    // its first offer so the mandate check can say why (out of stock, used) instead of "not found".
    const buyable = shop
      .filter((o) => o.availability === "InStock" && o.condition !== "used")
      .sort((a, b) => a.price.price - b.price.price);
    const offer = buyable[0] ?? shop[0];
    if (!offer) return null;
    return {
      productId: p.id,
      title: p.title,
      merchant: offer.domain,
      brand: p.brands?.[0]?.name ?? "",
      price: usdFromDollars(offer.price.price),
      attributes: Object.fromEntries((p.variants?.selected ?? []).map((s) => [s.name, s.label])),
      url: offer.url,
      inStock: offer.availability === "InStock",
      condition: offer.condition ?? "unknown",
    };
  }

  private product(productId: string, qs: string): Promise<Channel3Product | null> {
    const key = `${productId}\n${qs}`;
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    const req = this.fetchProduct(productId, qs).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, req);
    return req;
  }

  private async fetchProduct(productId: string, qs: string): Promise<Channel3Product | null> {
    const res = await this.http(`${BASE_URL}/v1/products/${encodeURIComponent(productId)}${qs}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "x-api-key": this.cfg.apiKey },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Channel3Error(res.status);
    return (await res.json()) as Channel3Product;
  }
}
