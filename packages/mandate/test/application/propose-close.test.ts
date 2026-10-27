import { expect, test } from "bun:test";
import { usd } from "@entole/shared-kernel";
import {
  FakePaymentGateway,
  FakeProductSearch,
  FixedClock,
  InMemoryMandateRepository,
  must,
  SequentialIds,
} from "@entole/testing";
import {
  closeMandate,
  createMandate,
  fundMandate,
  NotRefundable,
  proposeOrder,
  type ResolvedOffer,
  refundMandate,
  remaining,
} from "../../src/index.ts";

const offer = (cents: number, productId = "p1"): ResolvedOffer => ({
  productId,
  title: "Shoe",
  merchant: "shop.test",
  brand: "",
  price: usd(cents),
  attributes: { size: "10" },
  url: "https://shop.test/p",
});

const setup = async (authExpiresAt?: Date) => {
  const repo = new InMemoryMandateRepository();
  const gateway = new FakePaymentGateway();
  if (authExpiresAt) gateway.authorizationExpiresAt = authExpiresAt;
  const clock = new FixedClock(new Date("2026-10-26T00:00:00Z"));
  const ids = new SequentialIds();
  const search = new FakeProductSearch([], [offer(7200, "p72"), offer(14000, "p140")]);
  const deps = { repo, gateway, clock, ids, search };
  const { mandate } = await createMandate(deps, {
    ownerId: "u1",
    terms: {
      kind: "standard",
      candidates: [],
      item: { query: "shoes", requiredAttributes: { size: "10" }, brands: [], avoid: [] },
      maxUnitPrice: usd(8000),
      budget: usd(8000),
      allowedMerchants: [],
      validUntil: new Date("2026-10-27T00:00:00Z"),
    },
    demoInjection: false,
    baseUrl: "https://entole.test",
  });
  await fundMandate(deps, { mandateId: mandate.id, orderId: "order-1" });
  const propose = (productId: string) =>
    proposeOrder(deps, {
      mandateId: mandate.id,
      productId,
      merchant: "shop.test",
      options: { size: "10" },
      source: "agent",
    });
  const kinds = async () => (await repo.listAudit(mandate.id)).map((e) => e.kind);
  return { deps, repo, gateway, clock, id: mandate.id, propose, kinds };
};

test("allow at $72 captures and leaves $8", async () => {
  const s = await setup();
  const r = await s.propose("p72");
  expect(r.verdict.kind).toBe("allow");
  expect(r.captureId).toBe("cap-1");
  expect(s.gateway.captures).toHaveLength(1);
  expect(s.gateway.captures[0]?.amount.cents).toBe(7200);
  expect(s.gateway.captures[0]?.invoiceId).toBe(`${s.id}-1`);
  expect(remaining(must(await s.repo.get(s.id), "mandate")).cents).toBe(800);
  expect(await s.kinds()).toContain("proposal_allowed");
});

test("blocked $140 does not capture and audits proposal_blocked", async () => {
  const s = await setup();
  const r = await s.propose("p140");
  expect(r.verdict.kind).toBe("block");
  expect(s.gateway.captures).toHaveLength(0);
  expect(await s.kinds()).toContain("proposal_blocked");
});

test("the watcher logs a repeat block for the same shop once, a new reason or shop again", async () => {
  const s = await setup();
  const watch = (productId: string, merchant = "shop.test") =>
    proposeOrder(s.deps, {
      mandateId: s.id,
      productId,
      merchant,
      options: { size: "10" },
      source: "watcher",
    });
  await watch("p140");
  await watch("p140");
  await watch("p140", "other.test");
  s.deps.search = new FakeProductSearch([], [offer(15000, "p140")]);
  await watch("p140");
  const blocked = (await s.repo.listAudit(s.id)).filter((e) => e.kind === "proposal_blocked");
  expect(blocked.map((e) => e.data?.merchant)).toEqual(["shop.test", "other.test", "shop.test"]);
  expect(await s.repo.lastBlocked(s.id, "p140", "shop.test")).toEqual(blocked[2] ?? null);
  expect(await s.repo.lastBlocked(s.id, "p72", "shop.test")).toBeNull();
});

test("two concurrent $72 proposals: one allowed, one over_budget, one capture", async () => {
  const s = await setup();
  const [a, b] = await Promise.all([s.propose("p72"), s.propose("p72")]);
  const verdicts = [a.verdict, b.verdict];
  expect(verdicts.filter((v) => v.kind === "allow")).toHaveLength(1);
  const blocked = verdicts.find((v) => v.kind === "block");
  expect(blocked?.kind === "block" && blocked.reasons).toContain("over_budget");
  expect(s.gateway.captures).toHaveLength(1);
});

test("capture failure changes no state, audits capture_failed, next proposal works", async () => {
  const s = await setup();
  s.gateway.failNextCapture();
  const first = await s.propose("p72");
  expect(first.verdict.kind === "block" && first.verdict.details.join(" ")).toContain(
    "nothing was charged",
  );
  expect(first.captureId).toBeUndefined();
  expect(await s.kinds()).toContain("capture_failed");
  expect((await s.repo.get(s.id))?.captured.cents).toBe(0);
  const second = await s.propose("p72");
  expect(second.verdict.kind).toBe("allow");
});

test("expired mandate blocks with expired, close still voids once", async () => {
  const s = await setup();
  s.clock.advance(48 * 3600 * 1000);
  const r = await s.propose("p72");
  expect(r.verdict.kind === "block" && r.verdict.reasons).toContain("expired");
  await closeMandate(s.deps, s.id);
  expect(s.gateway.voids).toHaveLength(1);
});

test("PayPal authorization expiry blocks with expired before validUntil", async () => {
  const s = await setup(new Date("2026-10-26T12:00:00Z"));
  s.clock.advance(13 * 3600 * 1000);
  const r = await s.propose("p72");
  expect(r.verdict.kind === "block" && r.verdict.reasons).toContain("expired");
  expect(s.gateway.captures).toHaveLength(0);
});

test("close twice voids once", async () => {
  const s = await setup();
  await closeMandate(s.deps, s.id);
  await closeMandate(s.deps, s.id);
  expect(s.gateway.voids).toHaveLength(1);
  expect((await s.kinds()).filter((k) => k === "closed")).toHaveLength(1);
});

test("close when exhausted does not void", async () => {
  const s = await setup();
  s.deps.search = new FakeProductSearch([], [offer(8000, "p80")]);
  const r = await s.propose("p80");
  expect(r.verdict.kind).toBe("allow");
  expect((await s.repo.get(s.id))?.status).toBe("exhausted");
  await closeMandate(s.deps, s.id);
  expect(s.gateway.voids).toHaveLength(0);
});

test("a failing void leaves the mandate funded and a retry voids once", async () => {
  const s = await setup();
  s.gateway.failNextVoid();
  await expect(closeMandate(s.deps, s.id)).rejects.toThrow("void failed");
  expect((await s.repo.get(s.id))?.status).toBe("funded");
  expect(s.gateway.voids).toHaveLength(0);
  expect(await s.kinds()).not.toContain("closed");
  await closeMandate(s.deps, s.id);
  expect(s.gateway.voids).toHaveLength(1);
  expect((await s.repo.get(s.id))?.status).toBe("closed");
});

test("refund after a capture refunds once, records it and audits it", async () => {
  const s = await setup();
  await s.propose("p72");
  const first = await refundMandate(s.deps, s.id);
  expect(first.refund).toEqual({ id: "ref-1", amount: usd(7200) });
  expect(s.gateway.refunds).toEqual([{ captureId: "cap-1", idempotencyKey: `refund-${s.id}` }]);
  expect((await s.kinds()).filter((k) => k === "refunded")).toHaveLength(1);
  // Second call returns the current state; PayPal is not asked again.
  expect((await refundMandate(s.deps, s.id)).refund).toEqual(first.refund);
  expect(s.gateway.refunds).toHaveLength(1);
});

test("refund without a capture is rejected and nothing is sent to PayPal", async () => {
  const s = await setup();
  await expect(refundMandate(s.deps, s.id)).rejects.toBeInstanceOf(NotRefundable);
  expect(s.gateway.refunds).toHaveLength(0);
});

test("a capture PayPal declines moves no money and is audited with PayPal's status", async () => {
  const s = await setup();
  s.gateway.nextCaptureStatus = "DECLINED";
  const r = await s.propose("p72");
  expect(r.verdict.kind).toBe("block");
  expect(r.captureId).toBeUndefined();
  const m = must(await s.repo.get(s.id), "mandate");
  expect(m.status).toBe("funded");
  expect(remaining(m).cents).toBe(8000);
  const failed = (await s.repo.listAudit(s.id)).find((e) => e.kind === "capture_failed");
  expect(failed?.message).toBe("PayPal declined the capture, nothing was charged");
  expect(failed?.data?.paypalStatus).toBe("DECLINED");
});

test("a pending capture counts as bought and says PayPal is still completing it", async () => {
  const s = await setup();
  s.gateway.nextCaptureStatus = "PENDING";
  const r = await s.propose("p72");
  expect(r.verdict.kind).toBe("allow");
  const bought = (await s.repo.listAudit(s.id)).find((e) => e.kind === "proposal_allowed");
  expect(bought?.message).toContain("PayPal is still completing the payment");
  expect(bought?.data?.paypalStatus).toBe("PENDING");
});
