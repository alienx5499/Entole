import { expect, test } from "bun:test";
import { createMandate, fundMandate } from "@entole/mandate";
import { usd } from "@entole/shared-kernel";
import {
  FakePaymentGateway,
  FixedClock,
  InMemoryMandateRepository,
  InMemoryTasteRepository,
  SequentialIds,
} from "@entole/testing";
import { getTaste, rememberTaste } from "../../src/index.ts";

test("taste is saved per owner from the signed terms after funding", async () => {
  const deps = {
    repo: new InMemoryMandateRepository(),
    gateway: new FakePaymentGateway(),
    clock: new FixedClock(new Date("2026-10-26T00:00:00Z")),
    ids: new SequentialIds(),
    tastes: new InMemoryTasteRepository(),
  };
  const { mandate } = await createMandate(deps, {
    ownerId: "u1",
    terms: {
      kind: "standard",
      candidates: [],
      item: {
        query: "running shoes",
        requiredAttributes: { Size: "10" },
        brands: ["Nike"],
        avoid: ["white"],
      },
      maxUnitPrice: usd(8000),
      budget: usd(8000),
      allowedMerchants: [],
      validUntil: new Date("2026-10-27T00:00:00Z"),
    },
    demoInjection: false,
    baseUrl: "https://entole.test",
  });
  expect(await getTaste(deps, "u1")).toBeNull(); // created but never approved: no taste
  await rememberTaste(deps, await fundMandate(deps, { mandateId: mandate.id, orderId: "order-1" }));
  expect(await getTaste(deps, "u1")).toEqual({
    brands: ["Nike"],
    avoid: ["white"],
    attributes: { Size: "10" },
  });
  expect(await getTaste(deps, "u2")).toBeNull();
});
