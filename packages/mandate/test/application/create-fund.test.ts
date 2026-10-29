import { expect, test } from "bun:test";
import { usd } from "@entole/shared-kernel";
import {
  FakePaymentGateway,
  FixedClock,
  InMemoryMandateRepository,
  must,
  SequentialIds,
} from "@entole/testing";
import {
  AmountMismatch,
  closeMandate,
  createMandate,
  DigestMismatch,
  fundMandate,
  InvalidTransition,
  type MandateTerms,
  OrderNotApproved,
} from "../../src/index.ts";

const terms = (): MandateTerms => ({
  kind: "standard",
  candidates: [],
  item: { query: "running shoes", requiredAttributes: { size: "10" }, brands: [], avoid: [] },
  maxUnitPrice: usd(8000),
  budget: usd(8000),
  allowedMerchants: [],
  validUntil: new Date("2026-10-27T00:00:00Z"),
});

const setup = () => {
  const repo = new InMemoryMandateRepository();
  const gateway = new FakePaymentGateway();
  const clock = new FixedClock(new Date("2026-10-26T00:00:00Z"));
  const ids = new SequentialIds();
  return { deps: { repo, gateway, clock, ids }, repo, gateway };
};
const create = (s: ReturnType<typeof setup>) =>
  createMandate(s.deps, {
    ownerId: "u1",
    terms: terms(),
    demoInjection: false,
    baseUrl: "https://entole.test",
    shippingCallback: true,
  });

test("create gives awaiting_approval, sends digest as customId, audits once", async () => {
  const s = setup();
  const { mandate, approveUrl } = await create(s);
  expect(mandate.status).toBe("awaiting_approval");
  expect(approveUrl).toContain("http");
  const call = must(s.gateway.orders[0], "order");
  expect(call.customId).toBe(mandate.digest);
  expect(call.returnUrl).toBe(`https://entole.test/api/paypal/return?mandate=${mandate.id}`);
  expect(call.cancelUrl).toBe(`https://entole.test/mandates/${mandate.id}/review?cancelled=1`);
  expect(call.shippingCallbackUrl).toBe(
    `https://entole.test/api/paypal/shipping-callback?mandate=${mandate.id}`,
  );
  expect(await s.repo.listAudit(mandate.id)).toHaveLength(1);
});

test("local http dev sends no shipping callback, since PayPal cannot reach it", async () => {
  const s = setup();
  await createMandate(s.deps, {
    ownerId: "u1",
    terms: terms(),
    demoInjection: false,
    baseUrl: "http://localhost:3000",
    shippingCallback: true,
  });
  expect(must(s.gateway.orders[0], "order").shippingCallbackUrl).toBeUndefined();
});

test("the shipping callback stays off unless switched on", async () => {
  const s = setup();
  await createMandate(s.deps, {
    ownerId: "u1",
    terms: terms(),
    demoInjection: false,
    baseUrl: "https://entole.test",
  });
  expect(must(s.gateway.orders[0], "order").shippingCallbackUrl).toBeUndefined();
});

test("cancel URL uses the /mandates/ page and return URL stays on the API", async () => {
  const s = setup();
  const { mandate } = await create(s);
  const call = must(s.gateway.orders[0], "order");
  expect(call.cancelUrl).toContain("/mandates/");
  expect(call.returnUrl).toBe(`https://entole.test/api/paypal/return?mandate=${mandate.id}`);
});

test("fund gives funded status and audits funded", async () => {
  const s = setup();
  const { mandate } = await create(s);
  const funded = await fundMandate(s.deps, {
    mandateId: mandate.id,
    orderId: must(s.gateway.orders[0], "order").orderId,
  });
  expect(funded.status).toBe("funded");
  expect((await s.repo.get(mandate.id))?.status).toBe("funded");
  expect((await s.repo.listAudit(mandate.id)).map((e) => e.kind)).toEqual(["created", "funded"]);
});

test("fund with a different customId rejects with DigestMismatch and stays awaiting_approval", async () => {
  const s = setup();
  const { mandate } = await create(s);
  s.gateway.overrideCustomId = "tampered";
  await expect(
    fundMandate(s.deps, {
      mandateId: mandate.id,
      orderId: must(s.gateway.orders[0], "order").orderId,
    }),
  ).rejects.toBeInstanceOf(DigestMismatch);
  expect((await s.repo.get(mandate.id))?.status).toBe("awaiting_approval");
  expect(s.gateway.voids).toEqual(["auth-order-1"]);
});

test("fund on a closed mandate rejects without authorizing at PayPal", async () => {
  const s = setup();
  const { mandate } = await create(s);
  await closeMandate(s.deps, mandate.id);
  let authorized = 0;
  const original = s.gateway.authorizeOrder.bind(s.gateway);
  s.gateway.authorizeOrder = async (id) => {
    authorized++;
    return original(id);
  };
  await expect(
    fundMandate(s.deps, { mandateId: mandate.id, orderId: "order-1" }),
  ).rejects.toBeInstanceOf(InvalidTransition);
  expect(authorized).toBe(0);
  expect((await s.repo.get(mandate.id))?.status).toBe("closed");
});

test("fund with an order linked to a different mandate rejects", async () => {
  const s = setup();
  const a = await create(s);
  const b = await create(s);
  await expect(
    fundMandate(s.deps, { mandateId: a.mandate.id, orderId: "order-2" }),
  ).rejects.toThrow("does not belong");
  expect((await s.repo.get(b.mandate.id))?.status).toBe("awaiting_approval");
});

test("fund with an order not linked to that mandate rejects", async () => {
  const s = setup();
  const { mandate } = await create(s);
  await expect(
    fundMandate(s.deps, { mandateId: mandate.id, orderId: "other-order" }),
  ).rejects.toThrow();
  expect((await s.repo.get(mandate.id))?.status).toBe("awaiting_approval");
});

test("fund reads the approved order and authorizes when it matches the signed terms", async () => {
  const s = setup();
  const { mandate } = await create(s);
  await fundMandate(s.deps, { mandateId: mandate.id, orderId: "order-1" });
  expect(s.gateway.orderReads).toEqual(["order-1"]);
  expect(s.gateway.authorizations).toEqual(["order-1"]);
});

const refused = [
  ["an order that is not APPROVED", { status: "CREATED" }, OrderNotApproved],
  ["an order for another amount", { amount: { cents: 9000, currency: "USD" } }, AmountMismatch],
  ["an order in another currency", { amount: { cents: 8000, currency: "EUR" } }, AmountMismatch],
  ["an order with another custom_id", { customId: "tampered" }, DigestMismatch],
] as const;

for (const [name, order, error] of refused)
  test(`fund refuses ${name} and places no hold`, async () => {
    const s = setup();
    const { mandate } = await create(s);
    s.gateway.orderOverride = order;
    await expect(
      fundMandate(s.deps, { mandateId: mandate.id, orderId: "order-1" }),
    ).rejects.toBeInstanceOf(error);
    expect(s.gateway.authorizations).toEqual([]);
    expect(s.gateway.voids).toEqual([]);
    expect(s.gateway.captures).toEqual([]);
    expect((await s.repo.get(mandate.id))?.status).toBe("awaiting_approval");
  });

test("fund accepts a COMPLETED order, so a replay after a lost save still funds", async () => {
  const s = setup();
  const { mandate } = await create(s);
  s.gateway.orderOverride = { status: "COMPLETED" };
  const funded = await fundMandate(s.deps, { mandateId: mandate.id, orderId: "order-1" });
  expect(funded.status).toBe("funded");
  expect(s.gateway.authorizations).toEqual(["order-1"]);
});
