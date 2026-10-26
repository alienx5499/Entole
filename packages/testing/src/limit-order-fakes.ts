import type { PriceTracker } from "@entole/limit-order";

export class FakePriceTracker implements PriceTracker {
  started: string[] = [];
  failStarts = false;
  async start(productId: string) {
    if (this.failStarts) throw new Error("Channel3 price tracking failed");
    this.started.push(productId);
  }
  async history(_productId: string, _days: number) {
    return [];
  }
}
