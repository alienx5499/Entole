import { expect, test } from "bun:test";
import { type Mandate, type MandateLock, type MandateStatus, newMandate } from "@entole/mandate";
import { parseUsd } from "@entole/shared-kernel";
import { FixedClock, InMemoryMandateRepository } from "@entole/testing";
import { type PricePoint, proposeRequestedCheck, scheduleSteps } from "../../src/index.ts";

const MIN = 60_000;
const now = new Date("2026-11-01T01:00:00Z");
const validUntil = new Date("2026-11-04T00:00:00Z");

const order = (status: MandateStatus = "funded"): Mandate => ({
  ...newMandate({
    id: "m1",
    ownerId: "u1",
    now: new Date("2026-11-01T00:00:00Z"),
    terms: {
      kind: "limit",
      item: { query: "headphones", requiredAttributes: {}, brands: [], avoid: [] },
      candidates: [
        {
          productId: "p1",
          merchant: "shop.test",
          options: {},
          title: "Headphones",
          baselinePrice: parseUsd("499.00"),
        },
      ],
      maxUnitPrice: parseUsd("450.00"),
      budget: parseUsd("450.00"),
      allowedMerchants: [],
      validUntil,
    },
  }),
  status,
});

// Records which mandate ids ran under the lock, so a test can see the write was inside it.
class SpyLock implements MandateLock {
  held: string[] = [];
  inside = false;
  async run<T>(mandateId: string, fn: () => Promise<T>): Promise<T> {
    this.held.push(mandateId);
    this.inside = true;
    return fn().finally(() => {
      this.inside = false;
    });
  }
}

const setup = async (opts: { status?: MandateStatus; prices?: PricePoint[] } = {}) => {
  const repo = new InMemoryMandateRepository();
  await repo.save(order(opts.status));
  const lock = new SpyLock();
  const writes: boolean[] = [];
  const append = repo.appendAudit.bind(repo);
  repo.appendAudit = async (id, e) => {
    writes.push(lock.inside);
    return append(id, e);
  };
  const histories = { history: async () => new Map([["p1", opts.prices ?? []]]) };
  const deps = { repo, clock: new FixedClock(now), lock, histories };
  return { repo, lock, writes, deps };
};

const lastStep = async (repo: InMemoryMandateRepository) =>
  scheduleSteps(await repo.listAudit("m1")).at(-1)?.step;

test("with no time asked, the watcher suggests one from the latest known price, under the lock", async () => {
  const s = await setup({ prices: [{ at: now, price: parseUsd("460.00") }] });
  expect(await proposeRequestedCheck(s.deps, "m1", { by: "watcher" })).toBe("proposed");
  expect(await lastStep(s.repo)).toEqual({
    schedule: "proposed",
    at: new Date(now.getTime() + 15 * MIN).toISOString(),
    reason: "Best known price $460.00 is 2.2% above your limit",
    by: "watcher",
  });
  expect(s.lock.held).toEqual(["m1"]);
  expect(s.writes).toEqual([true]);
});

test("with no price history the suggestion uses the signed baseline price", async () => {
  const s = await setup();
  await proposeRequestedCheck(s.deps, "m1", { by: "watcher" });
  expect((await lastStep(s.repo))?.reason).toBe(
    "Best known price $499.00 is 10.9% above your limit",
  );
  const under = await setup({ prices: [{ at: now, price: parseUsd("440.00") }] });
  await proposeRequestedCheck(under.deps, "m1", { by: "watcher" });
  expect((await lastStep(under.repo))?.reason).toBe(
    "Best known price $440.00 is at or under your limit",
  );
});

test("an asked time keeps its trimmed reason, clipped to 200 characters, or a default", async () => {
  const s = await setup();
  const at = new Date(now.getTime() + 30 * MIN);
  await proposeRequestedCheck(s.deps, "m1", {
    at,
    reason: `  ${"r".repeat(250)} `,
    by: "ai_client",
  });
  expect(await lastStep(s.repo)).toEqual({
    schedule: "proposed",
    at: at.toISOString(),
    reason: "r".repeat(200),
    by: "ai_client",
  });
  await proposeRequestedCheck(s.deps, "m1", { at, reason: "  ", by: "ai_client" });
  expect((await lastStep(s.repo))?.reason).toBe("Extra check requested");
  expect(s.writes).toEqual([true, true]);
});

test("a time outside the signed limit, or no room left, records nothing", async () => {
  const s = await setup();
  expect(await proposeRequestedCheck(s.deps, "m1", { at: now, by: "watcher" })).toBe(
    "check_in_past",
  );
  const late = new Date(validUntil.getTime() + MIN);
  expect(await proposeRequestedCheck(s.deps, "m1", { at: late, by: "watcher" })).toBe(
    "past_valid_until",
  );
  const end = await setup();
  end.deps.clock = new FixedClock(new Date(validUntil.getTime() - 5 * MIN));
  expect(await proposeRequestedCheck(end.deps, "m1", { by: "watcher" })).toBe("past_valid_until");
  expect([...s.writes, ...end.writes]).toEqual([]);
});

test("an order that is no longer watching refuses the proposal", async () => {
  const s = await setup({ status: "exhausted" });
  expect(await proposeRequestedCheck(s.deps, "m1", { by: "watcher" })).toBe("not_watching");
  expect(s.writes).toEqual([]);
});
