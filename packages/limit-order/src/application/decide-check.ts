import {
  checkTimeRefusal,
  type MandateLock,
  type MandateRepository,
  withMandateLock,
} from "@entole/mandate/core";
import type { Clock } from "@entole/shared-kernel";
import type { ScheduleStepData } from "../domain/schedule-step.ts";
import { hhmm, scheduleSteps } from "./propose-check.ts";

export type DecideCheckDeps = {
  repo: Pick<MandateRepository, "appendAudit" | "listAudit" | "get">;
  clock: Clock;
  lock?: MandateLock; // the in-process lock when absent
};

export type DecideCheckResult =
  | { outcome: "accepted"; at: Date }
  | { outcome: "rejected" }
  | { outcome: "not_watching" | "no_pending_proposal" | "check_in_past" | "past_valid_until" };

// The buyer's answer to the open proposal. Accepting may carry a time the buyer dragged the
// proposal to; it must pass the same signed limit as a proposal. Under the order's lock, so two
// answers or an answer and a tick never both act on one proposal. Arming the check is the caller's.
export const decideCheck = (
  deps: DecideCheckDeps,
  mandateId: string,
  i: { accept: boolean; at?: Date },
): Promise<DecideCheckResult> =>
  withMandateLock(
    mandateId,
    async () => {
      const m = await deps.repo.get(mandateId);
      if (m?.status !== "funded" || m.terms.kind !== "limit") return { outcome: "not_watching" };
      const pending = scheduleSteps(await deps.repo.listAudit(m.id)).at(-1)?.step;
      if (pending?.schedule !== "proposed") return { outcome: "no_pending_proposal" };
      const now = deps.clock.now();
      if (!i.accept) {
        const data = { schedule: "rejected" } satisfies ScheduleStepData;
        await deps.repo.appendAudit(m.id, {
          at: now,
          kind: "agent_step",
          message: "Buyer rejected the proposed check",
          data,
        });
        return { outcome: "rejected" };
      }
      const at = i.at ?? new Date(pending.at ?? Number.NaN);
      const refused = checkTimeRefusal(m, at, now);
      if (refused) return { outcome: refused };
      const data = { schedule: "accepted", at: at.toISOString() } satisfies ScheduleStepData;
      await deps.repo.appendAudit(m.id, {
        at: now,
        kind: "agent_step",
        message: `Buyer accepted an extra check at ${hhmm(at)}`,
        data,
      });
      return { outcome: "accepted", at };
    },
    deps.lock,
  );
