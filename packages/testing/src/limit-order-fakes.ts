import type { MandateCheckDispatcher, PriceTracker } from "@entole/limit-order";

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

export class FakeMandateCheckDispatcher implements MandateCheckDispatcher {
  dispatched: string[] = [];
  eventIds: string[] = []; // the cause of each dispatch, in the same order
  failOnce = new Set<string>(); // each id listed here fails its next dispatch, once
  async dispatch(mandateId: string, cause: { eventId: string }) {
    if (this.failOnce.delete(mandateId)) throw new Error("dispatch failed");
    this.dispatched.push(mandateId);
    this.eventIds.push(cause.eventId);
  }
}
