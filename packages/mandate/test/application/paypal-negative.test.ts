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
  proposeOrder,
  refundMandate,
  remaining,
} from "../../src/index.ts";

// How the use cases react to the PayPal failures the live negative suite provokes with
// PayPal-Mock-Response. The gateway turns those answers into either a DECLINED result or a throw.

const offer = {
  productId: "p1",
  title: "Shoe",
  merchant: "shop.test",
  brand: "",
  price: usd(7200),
  attributes: {},
  url: "https://shop.test/p",
  inStock: true,
  condition: "new" as const,
};

const setup = async () => {
  const repo = new InMemoryMandateRepository();
  const gateway = new FakePaymentGateway();
  const clock = new FixedClock(new Date("2026-10-28T00:00:00Z"));
  const deps = { repo, gateway, clock, ids: new SequentialIds() };
  const { mandate } = await createMandate(deps, {
    ownerId: "u1",
    terms: {
      kind: "limit",
      candidates: [
        {
          productId: "p1",
          merchant: "shop.test",
          options: {},
          title: "Shoe",
          baselinePrice: usd(9000),
        },
      ],
      item: { query: "shoes", requiredAttributes: {}, brands: [], avoid: [] },
      maxUnitPrice: usd(8000),
      budget: usd(8000),
      allowedMerchants: [],
      validUntil: new Date("2026-11-20T00:00:00Z"),
    },
    demoInjection: false,
    baseUrl: "https://entole.test",
  });
  await fundMandate(deps, { mandateId: mandate.id, orderId: "order-1" });
  const search = new FakeProductSearch([], [offer]);
  const propose = () =>
    proposeOrder(
      { ...deps, search },
      {
        mandateId: mandate.id,
        productId: "p1",
        merchant: "shop.test",
        options: {},
        source: "watcher",
      },
    );
  const keys = () => gateway.captureAttempts.map((c) => c.idempotencyKey);
  const invoices = () => gateway.captureAttempts.map((c) => c.invoiceId);
  return { deps, repo, gateway, id: mandate.id, propose, keys, invoices };
};

test("an expired authorization or other error keeps the request id, so a retry cannot double charge", async () => {
  const s = await setup();
  s.gateway.failNextCapture();
  const r = await s.propose();
  expect(r.verdict.kind).toBe("block");
  const failed = (await s.repo.listAudit(s.id)).find((e) => e.kind === "capture_failed");
  expect(failed?.message).toBe("Payment provider error, nothing was charged");
  expect(failed?.data?.paypalStatus).toBeUndefined();
  expect(remaining(must(await s.repo.get(s.id), "mandate")).cents).toBe(8000);

  await s.propose();
  expect(s.keys()).toEqual([`${s.id}-capture`, `${s.id}-capture`]);
  // The invoice id still moves on, so PayPal's duplicate invoice check never blocks the retry.
  expect(s.invoices()).toEqual([`${s.id}-1`, `${s.id}-2`]);
  expect(must(await s.repo.get(s.id), "mandate").captured.cents).toBe(7200);
});

test("a declined capture rotates the request id once per decline", async () => {
  const s = await setup();
  s.gateway.nextCaptureStatus = "DECLINED";
  await s.propose();
  s.gateway.nextCaptureStatus = "DECLINED";
  await s.propose();
  await s.propose();
  expect(s.keys()).toEqual([`${s.id}-capture`, `${s.id}-capture-1`, `${s.id}-capture-2`]);
  const audit = await s.repo.listAudit(s.id);
  expect(audit.filter((e) => e.data?.paypalStatus === "DECLINED")).toHaveLength(2);
  expect(audit.filter((e) => e.kind === "proposal_allowed")).toHaveLength(1);
});

test("a failed refund changes nothing and the retry reuses the refund request id", async () => {
  const s = await setup();
  await s.propose();
  s.gateway.failNextRefund();
  await expect(refundMandate(s.deps, s.id)).rejects.toThrow("PayPal refund failed");
  expect(must(await s.repo.get(s.id), "mandate").refund).toBeUndefined();
  expect((await s.repo.listAudit(s.id)).some((e) => e.kind === "refunded")).toBe(false);

  const m = await refundMandate(s.deps, s.id);
  expect(m.refund?.amount).toEqual(usd(7200));
  expect(s.gateway.refunds).toEqual([{ captureId: "cap-1", idempotencyKey: `refund-${s.id}` }]);
});

test("a final capture releases the rest, so close never voids an already captured hold", async () => {
  const s = await setup();
  await s.propose();
  const closed = await closeMandate(s.deps, s.id);
  expect(closed.status).toBe("closed");
  expect(s.gateway.voids).toHaveLength(0);
});
