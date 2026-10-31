import type { Money } from "@entole/shared-kernel";

export interface PriceTracker {
  start(productId: string): Promise<void>;
  history(productId: string, days: number): Promise<{ at: Date; price: Money }[]>;
}

// Starts one check of one limit mandate: a Render Workflow task, or runWatcherTick in process.
// Resolves once the check is accepted, not when it finishes. The event id lets a redelivery of the
// same event start no second run.
export interface MandateCheckDispatcher {
  dispatch(mandateId: string, cause: { eventId: string }): Promise<void>;
}
