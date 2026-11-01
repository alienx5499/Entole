import {
  type AuditEntry,
  checkTimeRefusal,
  latestCheckAt,
  type Mandate,
  type MandateLock,
  type MandateRepository,
  withMandateLock,
} from "@entole/mandate";
import type { Clock } from "@entole/shared-kernel";
import { NEAR_LIMIT_PCT, suggestCheckTime } from "../domain/check-suggestion.ts";
import { type ProposedBy, type ScheduleStepData, scheduleStepOf } from "../domain/schedule-step.ts";

// At most one auto proposal per order in this long, so a price hovering near the limit never spams.
const AUTO_PROPOSAL_EVERY_MS = 6 * 60 * 60_000;

export type ProposeCheckDeps = {
  repo: Pick<MandateRepository, "appendAudit" | "listAudit" | "get">;
  clock: Clock;
  lock?: MandateLock; // the in-process lock when absent
};

/** A time as the audit log writes it, e.g. "14:05 UTC". */
export const hhmm = (d: Date) => `${d.toISOString().slice(11, 16)} UTC`;

/** The order's schedule changes, oldest first, each with the audit entry that records it. */
export const scheduleSteps = (audit: AuditEntry[]) =>
  audit.flatMap((entry) => {
    const step = scheduleStepOf(entry);
    return step ? [{ entry, step }] : [];
  });

// Proposes one extra price check. It moves nothing until the buyer accepts it, and a time after
// now and inside the signed limit (window end or hold expiry) is the only one recorded.
export const proposeCheck = async (
  deps: { repo: Pick<MandateRepository, "appendAudit">; clock: Clock },
  m: Mandate,
  i: { at: Date; reason: string; by: ProposedBy },
): Promise<"proposed" | "check_in_past" | "past_valid_until"> => {
  const now = deps.clock.now();
  const refused = checkTimeRefusal(m, i.at, now);
  if (refused) return refused;
  await deps.repo.appendAudit(m.id, {
    at: now,
    kind: "agent_step",
    message: `Agent proposes an extra check at ${hhmm(i.at)}: ${i.reason}`,
    data: {
      schedule: "proposed",
      at: i.at.toISOString(),
      reason: i.reason,
      by: i.by,
    } satisfies ScheduleStepData,
  });
  return "proposed";
};

// The watcher's own move: when the best quote sits just above the limit and nothing is already
// planned ahead, it proposes a sooner check through the same command an agent uses. Ticks for one
// order can overlap (hourly run, webhook check, API timer), so the read and write share its lock.
export const proposeCheckNearLimit = (
  deps: ProposeCheckDeps,
  mandateId: string,
  bestCents: number,
): Promise<"proposed" | "check_in_past" | "past_valid_until" | null> =>
  withMandateLock(
    mandateId,
    async () => {
      const m = await deps.repo.get(mandateId);
      if (m?.status !== "funded") return null;
      const suggestion = suggestCheckTime({
        bestCents,
        limitCents: m.terms.maxUnitPrice.cents,
        now: deps.clock.now(),
        latest: latestCheckAt(m),
      });
      if (!suggestion?.nearLimit) return null;
      const now = deps.clock.now().getTime();
      const steps = scheduleSteps(await deps.repo.listAudit(m.id));
      // An open proposal or an accepted extra check still ahead of now is soon enough.
      if (Date.parse(steps.at(-1)?.step.at ?? "") > now) return null;
      const recentAuto = ({ entry, step }: (typeof steps)[number]) =>
        step.by === "auto" && now - entry.at.getTime() < AUTO_PROPOSAL_EVERY_MS;
      if (steps.some(recentAuto)) return null;
      return proposeCheck(deps, m, {
        at: suggestion.at,
        reason: `Price is within ${NEAR_LIMIT_PCT}% of your limit`,
        by: "auto",
      });
    },
    deps.lock,
  );
