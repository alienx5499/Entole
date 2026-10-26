import { expect, test } from "bun:test";
import { usd } from "@entole/shared-kernel";
import {
  FakePaymentGateway,
  FixedClock,
  InMemoryMandateRepository,
  SequentialIds,
} from "@entole/testing";
import { createMandate, handlePayPalEvent, type MandateTerms } from "../../src/index.ts";

const terms = (): MandateTerms => ({
  kind: "standard",
  candidates: [],
  item: { query: "running shoes", requiredAttributes: {}, brands: [], avoid: [] },
  maxUnitPrice: usd(8000),
  budget: usd(8000),
  allowedMerchants: [],
  validUntil: new Date("2026-10-27T00:00:00Z"),
});

const setup = async () => {
  const repo = new InMemoryMandateRepository();
  const gateway = new FakePaymentGateway();
  let authorizes = 0;
  const authorize = gateway.authorizeOrder.bind(gateway);
  gateway.authorizeOrder = (orderId) => {
    authorizes++;
    return authorize(orderId);
  };
  const deps = {
    repo,
    gateway,
    clock: new FixedClock(new Date("2026-10-26T00:00:00Z")),
    ids: new SequentialIds(),
  };
  const { mandate } = await createMandate(deps, {
    ownerId: "u1",
    terms: terms(),
    demoInjection: false,
    baseUrl: "https://entole.test",
  });
  return { deps, repo, mandate, authorizes: () => authorizes };
};

const approved = (id: string, orderId = "order-1") => ({
  id,
  event_type: "CHECKOUT.ORDER.APPROVED",
  resource: { id: orderId },
});

test("an approved order funds the mandate once, even when delivered again", async () => {
  const s = await setup();
  const first = await handlePayPalEvent(s.deps, approved("WH-1"));
  expect(first.outcome).toBe("funded");
  expect((await s.repo.get(s.mandate.id))?.status).toBe("funded");
  expect((await handlePayPalEvent(s.deps, approved("WH-1"))).outcome).toBe("duplicate");
  // A second event id for the same order (the redirect already funded it) is a no-op too.
  expect((await handlePayPalEvent(s.deps, approved("WH-2"))).outcome).toBe("ignored");
  expect(s.authorizes()).toBe(1);
});

test("an approved event for an unknown order is ignored", async () => {
  const s = await setup();
  expect((await handlePayPalEvent(s.deps, approved("WH-1", "nope"))).outcome).toBe("ignored");
  expect(s.authorizes()).toBe(0);
});

test("a capture event adds a plain audit entry on the mandate, once", async () => {
  const s = await setup();
  const e = {
    id: "WH-9",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: { id: "CAP-1", supplementary_data: { related_ids: { order_id: "order-1" } } },
  };
  expect((await handlePayPalEvent(s.deps, e)).outcome).toBe("audited");
  expect((await handlePayPalEvent(s.deps, e)).outcome).toBe("duplicate");
  const entries = (await s.repo.listAudit(s.mandate.id)).filter((a) => a.kind === "paypal_event");
  expect(entries).toHaveLength(1);
  expect(entries[0]?.message).toBe("PayPal confirmed the capture");
  expect(entries[0]?.data?.resourceId).toBe("CAP-1");
});

test("other event types are ignored without claiming the id", async () => {
  const s = await setup();
  const e = { id: "WH-3", event_type: "BILLING.PLAN.CREATED" };
  expect((await handlePayPalEvent(s.deps, e)).outcome).toBe("ignored");
  expect(await s.repo.claimWebhookEvent("WH-3")).toBe(true);
});

test("a failed funding releases the event id so PayPal's retry is processed", async () => {
  const s = await setup();
  const authorize = s.deps.gateway.authorizeOrder;
  s.deps.gateway.authorizeOrder = async () => {
    throw new Error("PayPal down");
  };
  await expect(handlePayPalEvent(s.deps, approved("WH-1"))).rejects.toThrow("PayPal down");
  s.deps.gateway.authorizeOrder = authorize;
  expect((await handlePayPalEvent(s.deps, approved("WH-1"))).outcome).toBe("funded");
});
