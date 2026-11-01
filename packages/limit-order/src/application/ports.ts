import type { Mandate } from "@entole/mandate";
import type { PricePoint } from "../domain/price-stats.ts";

export interface PriceTracker {
  start(productId: string): Promise<void>;
  history(productId: string, days: number): Promise<PricePoint[]>;
}

// Starts one check of one limit mandate: a Render Workflow task, or runWatcherTick in process.
// Resolves once the check is accepted, not when it finishes. The event id lets a redelivery of the
// same event start no second run.
export interface MandateCheckDispatcher {
  dispatch(mandateId: string, cause: { eventId: string }): Promise<void>;
}

// The orders the API process watches on its own timers.
export interface WatchList {
  track(mandateId: string): void;
}

// Each candidate's recorded daily prices by product id, oldest first; empty when none are known.
export interface PriceHistories {
  history(m: Mandate): Promise<Map<string, PricePoint[]>>;
}
