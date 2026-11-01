import type { Mandate } from "@entole/mandate";
import { rememberTaste, type TasteRepository } from "@entole/shopping";
import type { WatchList } from "./ports.ts";
import { type LimitTrackingDeps, startLimitTracking } from "./start-limit-tracking.ts";

export type AfterFundingDeps = LimitTrackingDeps & { tastes: TasteRepository; watch: WatchList };

// Taste and tracking run after the money side: neither binds money, and a hiccup in either
// must not turn a funded mandate into an error. Shared by the browser return and the webhook.
export const afterFunding = async (deps: AfterFundingDeps, funded: Mandate): Promise<void> => {
  await rememberTaste(deps, funded).catch((err: unknown) => console.error(err));
  if (funded.terms.kind === "limit") {
    // Not awaited: a slow Channel3 must not delay the response. Failures are audited inside.
    void startLimitTracking(deps, funded).catch((err: unknown) => console.error(err));
    deps.watch.track(funded.id);
  }
};
