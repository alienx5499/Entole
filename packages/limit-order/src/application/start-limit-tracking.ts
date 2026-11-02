import type { Mandate, MandateRepository } from "@entole/mandate/core";
import type { Clock } from "@entole/shared-kernel";
import type { PriceTracker } from "./ports.ts";

export type LimitTrackingDeps = { tracker: PriceTracker; repo: MandateRepository; clock: Clock };

// Tracking is a nice-to-have for the price chart: a failure is audited, never thrown.
export const startLimitTracking = async (deps: LimitTrackingDeps, m: Mandate): Promise<void> => {
  for (const c of m.terms.candidates) {
    try {
      await deps.tracker.start(c.productId);
      await deps.repo.appendAudit(m.id, {
        at: deps.clock.now(),
        kind: "agent_step",
        message: `Price tracking started for ${c.title}`,
        data: { productId: c.productId },
      });
    } catch (err) {
      await deps.repo.appendAudit(m.id, {
        at: deps.clock.now(),
        kind: "agent_step",
        message: `Price tracking failed to start for ${c.title}`,
        data: {
          productId: c.productId,
          error: err instanceof Error ? err.message.slice(0, 200) : "unknown error",
        },
      });
    }
  }
};
