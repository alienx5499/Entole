import type { Money } from "@entole/shared-kernel";

export interface PriceTracker {
  start(productId: string): Promise<void>;
  history(productId: string, days: number): Promise<{ at: Date; price: Money }[]>;
}
