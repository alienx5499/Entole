import { expect, test } from "bun:test";
import { usd } from "@entole/shared-kernel";
import {
  FakePaymentGateway,
  FixedClock,
  InMemoryMandateRepository,
  must,
  SequentialIds,
} from "@entole/testing";
import { createMandate, fundMandate, renewMandateHold } from "../../src/index.ts";

const DAY = 24 * 3600 * 1000;

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
  return { deps, repo, gateway, clock, id: mandate.id };
};

test("inside the honor period nothing is sent to PayPal", async () => {
  const s = await setup();
  s.clock.advance(2 * DAY);
  expect(await renewMandateHold(s.deps, s.id)).toBe("not_due");
  expect(s.gateway.reauthorizations).toHaveLength(0);
});

test("after the honor period the hold is renewed once, audited, with a stable request id", async () => {
  const s = await setup();
  s.clock.advance(3 * DAY + 60_000);
  expect(await renewMandateHold(s.deps, s.id)).toBe("renewed");
  expect(s.gateway.reauthorizations).toEqual([
    {
      authorizationId: "auth-order-1",
      amount: usd(8000),
      idempotencyKey: "reauthorize-auth-order-1",
    },
  ]);
  const m = must(await s.repo.get(s.id), "mandate");
  expect(m.authorization?.id).toBe("reauth-auth-order-1");
  expect(m.authorization?.renewedAt).toEqual(s.clock.now());
  const audit = await s.repo.listAudit(s.id);
  expect(audit.at(-1)).toMatchObject({
    kind: "hold_renewed",
    data: { authorizationId: "reauth-auth-order-1", previousAuthorizationId: "auth-order-1" },
  });
  s.clock.advance(4 * DAY);
  expect(await renewMandateHold(s.deps, s.id)).toBe("not_due");
  expect(s.gateway.reauthorizations).toHaveLength(1);
});

test("a denied renewal is audited and leaves the mandate for the caller to close", async () => {
  const s = await setup();
  s.clock.advance(4 * DAY);
  s.gateway.nextReauthorize = "denied";
  expect(await renewMandateHold(s.deps, s.id)).toBe("denied");
  const m = must(await s.repo.get(s.id), "mandate");
  expect(m.authorization?.id).toBe("auth-order-1");
  expect(m.authorization?.renewedAt).toBeUndefined();
  const last = (await s.repo.listAudit(s.id)).at(-1);
  expect(last?.message).toContain("declined to renew");
  expect(last?.data?.reason).toBe("REAUTHORIZATION_DECLINED_BY_PROCESSOR");
});

test("a transient PayPal failure throws and changes nothing, so the next tick retries", async () => {
  const s = await setup();
  s.clock.advance(4 * DAY);
  s.gateway.nextReauthorize = "error";
  await expect(renewMandateHold(s.deps, s.id)).rejects.toThrow("reauthorize failed");
  expect(must(await s.repo.get(s.id), "mandate").authorization?.renewedAt).toBeUndefined();
  expect(await renewMandateHold(s.deps, s.id)).toBe("renewed");
});
