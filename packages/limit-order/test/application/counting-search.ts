import type { ResolvedOffer } from "@entole/mandate";
import { usd } from "@entole/shared-kernel";
import { FakeProductSearch } from "@entole/testing";

export const offer = (productId: string, merchant: string, cents: number): ResolvedOffer => ({
  productId,
  title: `Shoe ${productId}`,
  merchant,
  brand: "",
  price: usd(cents),
  attributes: { Size: "10" },
  url: `https://${merchant}/${productId}`,
  inStock: true,
  condition: "new",
});
export const summary = (o: ResolvedOffer) => ({
  productId: o.productId,
  title: o.title,
  offers: [{ merchant: o.merchant, price: o.price }],
  options: { Size: ["9", "10"] },
  description: "",
});
// Counts live resolveOffer calls; each product can resolve after its own delay or fail on demand.
export class CountingSearch extends FakeProductSearch {
  calls: string[] = [];
  inFlight = 0;
  maxInFlight = 0;
  failNext = 0;
  constructor(
    offers: ResolvedOffer[],
    private readonly delayMs: Record<string, number> = {},
  ) {
    super(offers.map(summary), offers);
  }
  override async resolveOffer(i: Parameters<FakeProductSearch["resolveOffer"]>[0]) {
    this.calls.push(i.productId);
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    await new Promise((r) => setTimeout(r, this.delayMs[i.productId] ?? 0));
    this.inFlight--;
    if (this.failNext > 0 && this.failNext--) throw new Error("catalog down");
    return super.resolveOffer(i);
  }
}
