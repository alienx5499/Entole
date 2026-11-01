import { expect, test } from "bun:test";
import { type Mandate, type MandateStatus, newMandate } from "@entole/mandate";
import { parseUsd } from "@entole/shared-kernel";
import { FixedClock, InMemoryMandateRepository } from "@entole/testing";
import { decideCheck, proposeCheck, scheduleSteps } from "../../src/index.ts";

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

const setup = async (status?: MandateStatus) => {
  const repo = new InMemoryMandateRepository();
  const m = order(status);
  await repo.save(m);
  const deps = { repo, clock: new FixedClock(now) };
  const proposed = new Date(now.getTime() + 30 * MIN);
  await proposeCheck(deps, m, { at: proposed, reason: "Sale soon", by: "ai_client" });
  return { repo, deps, proposed };
};

const lastStep = async (repo: InMemoryMandateRepository) =>
  scheduleSteps(await repo.listAudit("m1")).at(-1)?.step;

test("accepting arms the proposed time and records it", async () => {
  const { repo, deps, proposed } = await setup();
  expect(await decideCheck(deps, "m1", { accept: true })).toEqual({
    outcome: "accepted",
    at: proposed,
  });
  expect(await lastStep(repo)).toEqual({ schedule: "accepted", at: proposed.toISOString() });
});

test("accepting a dragged time checks it against the signed limit first", async () => {
  const { repo, deps } = await setup();
  const late = new Date(validUntil.getTime() + 1);
  expect(await decideCheck(deps, "m1", { accept: true, at: late })).toEqual({
    outcome: "past_valid_until",
  });
  expect(await decideCheck(deps, "m1", { accept: true, at: now })).toEqual({
    outcome: "check_in_past",
  });
  expect((await lastStep(repo))?.schedule).toBe("proposed");
  const dragged = new Date(now.getTime() + 2 * 60 * MIN);
  expect(await decideCheck(deps, "m1", { accept: true, at: dragged })).toEqual({
    outcome: "accepted",
    at: dragged,
  });
});

test("rejecting records the answer and arms nothing", async () => {
  const { repo, deps } = await setup();
  expect(await decideCheck(deps, "m1", { accept: false })).toEqual({ outcome: "rejected" });
  expect(await lastStep(repo)).toEqual({ schedule: "rejected" });
});

test("an answered proposal or an order no longer watching has nothing to decide", async () => {
  const { deps } = await setup();
  await decideCheck(deps, "m1", { accept: false });
  expect(await decideCheck(deps, "m1", { accept: true })).toEqual({
    outcome: "no_pending_proposal",
  });
  const closed = await setup("closed");
  expect(await decideCheck(closed.deps, "m1", { accept: true })).toEqual({
    outcome: "not_watching",
  });
});
