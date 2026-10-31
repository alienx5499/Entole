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

const MIN = 60_000;

// The watcher proposes on its own when the best quote is this close above the limit.
export const NEAR_LIMIT_PCT = 5;
// At most one such proposal per order in this long, so a price hovering near the limit never spams.
const AUTO_PROPOSAL_EVERY_MS = 6 * 60 * MIN;
// How soon after the tick the proposed check lands, clamped inside the signed limit.
const AUTO_PROPOSAL_LEAD_MS = 15 * MIN;
// Less room than this before the limit and the buyer could not answer in time, so none is made.
const MIN_PROPOSAL_LEAD_MS = 5 * MIN;

// Who proposed: an AI client's token, the buyer's "Ask the watcher" button (the watcher picks
// the time), or the watcher on its own during a tick.
export type ProposedBy = "ai_client" | "watcher" | "auto";

export type ProposeCheckDeps = {
  repo: Pick<MandateRepository, "appendAudit" | "listAudit" | "get">;
  clock: Clock;
  lock?: MandateLock; // the in-process lock when absent
};

/** A time as the audit log writes it, e.g. "14:05 UTC". */
export const hhmm = (d: Date) => `${d.toISOString().slice(11, 16)} UTC`;

// Schedule changes are audit entries (`agent_step` with `data.schedule`), so the proposal, the
// buyer's answer and who made it survive a restart and read back in the order's history.
export const scheduleSteps = (audit: AuditEntry[]) =>
  audit.filter((e) => e.kind === "agent_step" && e.data?.schedule !== undefined);

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
    data: { schedule: "proposed", at: i.at.toISOString(), reason: i.reason, by: i.by },
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
      const limit = m.terms.maxUnitPrice.cents;
      const gap = ((bestCents - limit) / limit) * 100;
      if (gap <= 0 || gap > NEAR_LIMIT_PCT) return null;
      const now = deps.clock.now().getTime();
      const steps = scheduleSteps(await deps.repo.listAudit(m.id));
      // An open proposal or an accepted extra check still ahead of now is soon enough.
      if (Date.parse(steps.at(-1)?.data?.at ?? "") > now) return null;
      if (steps.some((e) => e.data?.by === "auto" && now - e.at.getTime() < AUTO_PROPOSAL_EVERY_MS))
        return null;
      const at = Math.min(now + AUTO_PROPOSAL_LEAD_MS, latestCheckAt(m).getTime() - MIN);
      if (at - now < MIN_PROPOSAL_LEAD_MS) return null;
      return proposeCheck(deps, m, {
        at: new Date(at),
        reason: `Price is within ${NEAR_LIMIT_PCT}% of your limit`,
        by: "auto",
      });
    },
    deps.lock,
  );
