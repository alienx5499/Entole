const MIN = 60_000;

// A quote this close above the limit makes the watcher propose a sooner check on its own.
export const NEAR_LIMIT_PCT = 5;
// How soon after now a suggested check lands, clamped inside the signed limit.
const LEAD_MS = 15 * MIN;
// Less room than this before the limit and the buyer could not answer in time.
const MIN_LEAD_MS = 5 * MIN;

export type CheckSuggestion = { at: Date; gapPct: number; nearLimit: boolean };

// The one rule for when an extra price check should run. `latest` is the signed limit (window end
// or hold expiry, whichever is first); the check lands a minute before it at the latest. Null
// when there is no time left for the buyer to answer.
export const suggestCheckTime = (i: {
  bestCents: number;
  limitCents: number;
  now: Date;
  latest: Date;
}): CheckSuggestion | null => {
  const now = i.now.getTime();
  const at = Math.min(now + LEAD_MS, i.latest.getTime() - MIN);
  if (at - now < MIN_LEAD_MS) return null;
  const gapPct = ((i.bestCents - i.limitCents) / i.limitCents) * 100;
  return { at: new Date(at), gapPct, nearLimit: gapPct > 0 && gapPct <= NEAR_LIMIT_PCT };
};
