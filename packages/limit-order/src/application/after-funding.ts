import type { Mandate } from "@entole/mandate/core";
import type { Logger } from "@entole/shared-kernel";
import { rememberTaste, type TasteRepository } from "@entole/shopping/core";
import type { WatchList } from "./ports.ts";
import { type LimitTrackingDeps, startLimitTracking } from "./start-limit-tracking.ts";

export type AfterFundingDeps = LimitTrackingDeps & {
  tastes: TasteRepository;
  watch: WatchList;
  logger: Logger;
};

// Taste and tracking run after the money side: neither binds money, and a hiccup in either
// must not turn a funded mandate into an error. Shared by the browser return and the webhook.
export const afterFunding = async (deps: AfterFundingDeps, funded: Mandate): Promise<void> => {
  await rememberTaste(deps, funded).catch((err: unknown) =>
    deps.logger.error("taste not saved:", err),
  );
  if (funded.terms.kind === "limit") {
    // Not awaited: a slow Channel3 must not delay the response. Failures are audited inside.
    void startLimitTracking(deps, funded).catch((err: unknown) =>
      deps.logger.error("limit tracking not started:", err),
    );
    deps.watch.track(funded.id);
  }
};
