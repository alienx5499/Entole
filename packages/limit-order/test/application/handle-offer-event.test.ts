import { expect, test } from "bun:test";
import { type Mandate, type MandateStatus, newMandate } from "@entole/mandate";
import { parseUsd } from "@entole/shared-kernel";
import {
  FakeMandateCheckDispatcher,
  FakePriceTracker,
  FixedClock,
  InMemoryMandateRepository,
  InMemoryTasteRepository,
  RecordingLogger,
} from "@entole/testing";
import {
  afterFunding,
  handleOfferEvent,
  type OfferEvent,
  recordReplayStarted,
} from "../../src/index.ts";

const now = new Date("2026-11-01T01:00:00Z");

const order = (
  id: string,
  status: MandateStatus = "funded",
  kind: "limit" | "standard" = "limit",
) =>
  ({
    ...newMandate({
      id,
      ownerId: "u1",
      now: new Date("2026-11-01T00:00:00Z"),
      terms: {
        kind,
        item: { query: "headphones", requiredAttributes: {}, brands: ["Acme"], avoid: [] },
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
        validUntil: new Date("2026-11-03T00:00:00Z"),
      },
    }),
    status,
  }) satisfies Mandate;

const event = (price: string): OfferEvent => ({
  id: "evt_1",
  kind: "price",
  productId: "p1",
  domain: "shop.test",
  price: parseUsd(price),
  inStock: null,
});

const setup = async () => {
  const repo = new InMemoryMandateRepository();
  await repo.save(order("m1"));
  const dispatcher = new FakeMandateCheckDispatcher();
  const logger = new RecordingLogger();
  return {
    repo,
    dispatcher,
    logger,
    deps: { repo, dispatcher, clock: new FixedClock(now), logger },
  };
};

test("an event under the limit dispatches the order's check, then records the wake", async () => {
  const s = await setup();
  expect(await handleOfferEvent(s.deps, event("439.00"))).toEqual({
    outcome: "dispatched",
    checks: 1,
    notes: 0,
  });
  expect(s.dispatcher.dispatched).toEqual(["m1"]);
  expect(s.dispatcher.eventIds).toEqual(["evt_1"]);
  expect((await s.repo.listAudit("m1")).map((e) => e.data?.eventId)).toEqual(["evt_1"]);
});

test("an event over the limit dispatches nothing and records one note", async () => {
  const s = await setup();
  expect(await handleOfferEvent(s.deps, event("460.00"))).toEqual({
    outcome: "dispatched",
    checks: 0,
    notes: 1,
  });
  expect(s.dispatcher.dispatched).toEqual([]);
  expect(await s.repo.listAudit("m1")).toHaveLength(1);
});

test("a failed dispatch records nothing, notes included, so a retry dispatches again", async () => {
  const s = await setup();
  s.dispatcher.failOnce.add("m1");
  expect(await handleOfferEvent(s.deps, event("439.00"))).toEqual({
    outcome: "dispatch_failed",
  });
  expect(await s.repo.listAudit("m1")).toEqual([]);
  expect(s.logger.errors.map((e) => e.message)).toEqual(["channel3 event evt_1 dispatch failed:"]);
});

test("a failed audit write after dispatch still reports the started checks", async () => {
  const s = await setup();
  s.repo.appendAudit = async () => {
    throw new Error("db down");
  };
  expect(await handleOfferEvent(s.deps, event("439.00"))).toEqual({
    outcome: "dispatched",
    checks: 1,
    notes: 0,
  });
  expect(s.dispatcher.dispatched).toEqual(["m1"]);
  expect(s.logger.errors.map((e) => e.message)).toEqual([
    "channel3 event evt_1 wake audit failed:",
  ]);
});

const fundingDeps = (repo: InMemoryMandateRepository) => {
  const tracked: string[] = [];
  return {
    tracked,
    tastes: new InMemoryTasteRepository(),
    tracker: new FakePriceTracker(),
    deps: {
      repo,
      clock: new FixedClock(now),
      logger: new RecordingLogger(),
      watch: { track: (id: string) => void tracked.push(id) },
    },
  };
};

test("after funding a limit order, taste is kept, tracking starts and the order is watched", async () => {
  const repo = new InMemoryMandateRepository();
  const m = order("m1");
  await repo.save(m);
  const f = fundingDeps(repo);
  await afterFunding({ ...f.deps, tastes: f.tastes, tracker: f.tracker }, m);
  expect((await f.tastes.get("u1"))?.brands).toEqual(["Acme"]);
  expect(f.tracked).toEqual(["m1"]);
  await Bun.sleep(0);
  expect(f.tracker.started).toEqual(["p1"]);
});

test("after funding, a taste failure never throws and a standard order is not watched", async () => {
  const repo = new InMemoryMandateRepository();
  const f = fundingDeps(repo);
  const tastes = new InMemoryTasteRepository();
  tastes.save = async () => {
    throw new Error("db down");
  };
  await afterFunding({ ...f.deps, tastes, tracker: f.tracker }, order("m2", "funded", "standard"));
  expect(f.deps.logger.errors.map((e) => e.message)).toEqual(["taste not saved:"]);
  expect(f.tracked).toEqual([]);
  expect(f.tracker.started).toEqual([]);
});

test("a started replay is recorded on the order's timeline", async () => {
  const repo = new InMemoryMandateRepository();
  await recordReplayStarted({ repo, clock: new FixedClock(now) }, "m1", 30);
  expect(await repo.listAudit("m1")).toEqual([
    {
      at: now,
      kind: "agent_step",
      message: "Price replay started: 30 recorded daily prices",
      data: { replay: "started" },
    },
  ]);
});
