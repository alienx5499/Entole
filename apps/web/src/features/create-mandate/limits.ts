// Copies of the API's limits so the form can hint before sending. The API owns them;
// apps/api/test/limit-copies.test.ts pins these to the domain.
export const MIN_LIMIT_USD = 1;
export const MAX_LIMIT_USD = 5000;
export const MAX_VALID_DAYS = 29;

const DAY_MS = 86_400_000;

/** The window an earlier order ran, in whole days the form can offer again. */
export const daysBetween = (m: { createdAt: string; validUntil: string }) =>
  Math.min(
    MAX_VALID_DAYS,
    Math.max(1, Math.round((Date.parse(m.validUntil) - Date.parse(m.createdAt)) / DAY_MS)),
  );
