import { expect, test } from "bun:test";
import { NEAR_LIMIT_PCT, suggestCheckTime } from "../../src/index.ts";

const MIN = 60_000;
const now = new Date("2026-10-26T12:00:00Z");
const DAY_LATER = new Date(now.getTime() + 24 * 60 * MIN);
const suggest = (bestCents: number, latest = DAY_LATER) =>
  suggestCheckTime({ bestCents, limitCents: 10_000, now, latest });

test("the check lands 15 minutes ahead", () => {
  expect(suggest(10_300)?.at).toEqual(new Date(now.getTime() + 15 * MIN));
});

test("only a quote above the limit and within the band is near it", () => {
  expect(suggest(10_000)?.nearLimit).toBe(false);
  expect(suggest(10_001)?.nearLimit).toBe(true);
  expect(suggest(10_000 + NEAR_LIMIT_PCT * 100)?.nearLimit).toBe(true);
  expect(suggest(10_000 + NEAR_LIMIT_PCT * 100 + 1)?.nearLimit).toBe(false);
  expect(suggest(10_590)?.gapPct).toBeCloseTo(5.9);
});

test("the check never lands past the signed limit, a minute before it at the latest", () => {
  const latest = new Date(now.getTime() + 10 * MIN);
  expect(suggest(10_300, latest)?.at).toEqual(new Date(now.getTime() + 9 * MIN));
});

test("with less than 5 minutes of lead time there is no suggestion", () => {
  expect(suggest(10_300, new Date(now.getTime() + 6 * MIN))?.at).toEqual(
    new Date(now.getTime() + 5 * MIN),
  );
  expect(suggest(10_300, new Date(now.getTime() + 6 * MIN - 1))).toBeNull();
});
