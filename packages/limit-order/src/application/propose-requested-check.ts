import { latestCheckAt, withMandateLock } from "@entole/mandate/core";
import { formatUsd, usd } from "@entole/shared-kernel";
import { suggestCheckTime } from "../domain/check-suggestion.ts";
import type { ProposedBy } from "../domain/schedule-step.ts";
import type { PriceHistories } from "./ports.ts";
import { type ProposeCheckDeps, proposeCheck } from "./propose-check.ts";

const MAX_REASON = 200;

export type ProposeRequestedCheckDeps = ProposeCheckDeps & { histories: PriceHistories };

// One extra price check asked for by the buyer's watcher or an AI client. With no `at` the
// watcher picks the time from the cheapest known price, by the same rule as its automatic
// proposals (suggestCheckTime). Under the order's lock, so it never races a tick or an answer.
export const proposeRequestedCheck = async (
  deps: ProposeRequestedCheckDeps,
  mandateId: string,
  i: { at?: Date; reason?: string; by: ProposedBy },
): Promise<"proposed" | "check_in_past" | "past_valid_until" | "not_watching"> => {
  // The price history can mean a Channel3 call, so it is fetched before taking the lock.
  const histories =
    i.at === undefined
      ? await deps.repo.get(mandateId).then((m) => (m ? deps.histories.history(m) : new Map()))
      : new Map();
  return withMandateLock(
    mandateId,
    async () => {
      const m = await deps.repo.get(mandateId);
      if (m?.status !== "funded" || m.terms.kind !== "limit") return "not_watching";
      if (i.at !== undefined) {
        const reason = i.reason?.trim().slice(0, MAX_REASON) || "Extra check requested";
        return proposeCheck(deps, m, { at: i.at, reason, by: i.by });
      }
      const best = Math.min(
        ...m.terms.candidates.map(
          (c) => histories.get(c.productId)?.at(-1)?.price.cents ?? c.baselinePrice.cents,
        ),
      );
      const s = suggestCheckTime({
        bestCents: best,
        limitCents: m.terms.maxUnitPrice.cents,
        now: deps.clock.now(),
        latest: latestCheckAt(m),
      });
      if (!s) return "past_valid_until";
      const price = `Best known price $${formatUsd(usd(best))}`;
      const reason =
        s.gapPct <= 0
          ? `${price} is at or under your limit`
          : `${price} is ${s.gapPct.toFixed(1)}% above your limit`;
      return proposeCheck(deps, m, { at: s.at, reason, by: i.by });
    },
    deps.lock,
  );
};
