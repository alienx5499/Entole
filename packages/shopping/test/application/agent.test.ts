import { expect, test } from "bun:test";
import { createMandate, fundMandate, type ResolvedOffer } from "@entole/mandate";
import { usd } from "@entole/shared-kernel";
import {
  FakePaymentGateway,
  FakeProductSearch,
  FixedClock,
  InMemoryMandateRepository,
  must,
  ScriptedAgentModel,
  SequentialIds,
} from "@entole/testing";
import { runShoppingAgent, withDemoInjection } from "../../src/index.ts";

const good: ResolvedOffer = {
  productId: "p72",
  title: "Trail Shoe",
  merchant: "shop.test",
  brand: "",
  price: usd(7200),
  attributes: { Size: "10" },
  url: "https://shop.test/p72",
};

const call = (name: string, args: unknown, id = name) => ({
  id,
  name,
  argsJson: typeof args === "string" ? args : JSON.stringify(args),
});
const tools = (...calls: ReturnType<typeof call>[]) => ({ kind: "tools" as const, calls });

const setup = async (
  turns: Parameters<typeof tools>[0][] | ConstructorParameters<typeof ScriptedAgentModel>[0],
) => {
  const repo = new InMemoryMandateRepository();
  const gateway = new FakePaymentGateway();
  const base = new FakeProductSearch(
    [
      {
        productId: "p72",
        title: "Trail Shoe",
        offers: [{ merchant: "shop.test", price: usd(7200) }],
        options: { Size: ["10"] },
        description: "x".repeat(500),
      },
    ],
    [good],
  );
  const deps0 = {
    repo,
    gateway,
    clock: new FixedClock(new Date("2026-10-26T00:00:00Z")),
    ids: new SequentialIds(),
    search: withDemoInjection(base),
  };
  const { mandate } = await createMandate(deps0, {
    ownerId: "u1",
    terms: {
      kind: "standard",
      candidates: [],
      item: { query: "running shoes", requiredAttributes: { Size: "10" }, brands: [], avoid: [] },
      maxUnitPrice: usd(8000),
      budget: usd(8000),
      allowedMerchants: [],
      validUntil: new Date("2026-10-27T00:00:00Z"),
    },
    demoInjection: true,
    baseUrl: "https://entole.test",
  });
  await fundMandate(deps0, { mandateId: mandate.id, orderId: "order-1" });
  const model = new ScriptedAgentModel(
    turns as ConstructorParameters<typeof ScriptedAgentModel>[0],
  );
  return { deps: { ...deps0, model }, model, repo, gateway, id: mandate.id };
};

test("trap is blocked, valid item is bought, agent finishes", async () => {
  const { deps, model, repo, gateway, id } = await setup([
    tools(call("search_products", { query: "running shoes" })),
    tools(
      call("propose_order", {
        product_id: "demo-trap-1",
        merchant: "deals-unlimited.example",
        options: { Size: "11" },
      }),
    ),
    tools(
      call("propose_order", { product_id: "p72", merchant: "shop.test", options: { Size: "10" } }),
    ),
    tools(call("finish", { summary: "Bought Trail Shoe" })),
  ]);
  const r = await runShoppingAgent(deps, { mandateId: id });
  expect(r).toEqual({ steps: 4, outcome: "finished", summary: "Bought Trail Shoe" });
  const audit = await repo.listAudit(id);
  const blocked = audit.filter((e) => e.kind === "proposal_blocked");
  expect(blocked).toHaveLength(1);
  expect(blocked[0]?.data?.reasons).toContain("over_unit_price");
  expect(blocked[0]?.data?.reasons).toContain("wrong_attribute");
  expect(audit.filter((e) => e.kind === "proposal_allowed")).toHaveLength(1);
  expect(audit.filter((e) => e.kind === "agent_step")).toHaveLength(4);
  expect(gateway.captures).toHaveLength(1);
  const toolMsgs = must(model.seen[3], "model call 3")
    .messages.filter((m) => m.role === "tool")
    .map((m) => JSON.parse(m.content));
  expect(toolMsgs[0]).toHaveLength(2);
  expect(toolMsgs[0][1].description).toHaveLength(300);
  expect(toolMsgs[1]).toMatchObject({ verdict: "blocked" });
  expect(toolMsgs[2]).toEqual({ verdict: "allowed", captureId: "cap-1" });
});

test("agent keeps going after an allowed purchase until finish", async () => {
  const { deps, id } = await setup([
    tools(
      call("propose_order", { product_id: "p72", merchant: "shop.test", options: { Size: "10" } }),
    ),
    { kind: "tools", calls: [call("finish", { summary: "done" })] },
  ]);
  const r = await runShoppingAgent(deps, { mandateId: id });
  expect(r.steps).toBe(2);
});

test("a model that never finishes stops at the step limit", async () => {
  const { deps, id } = await setup(
    Array.from({ length: 6 }, () => tools(call("search_products", { query: "shoes" }))),
  );
  expect(await runShoppingAgent(deps, { mandateId: id })).toMatchObject({
    steps: 6,
    outcome: "step_limit",
  });
});

test("garbage tool arguments give an invalid arguments result", async () => {
  const { deps, model, id } = await setup([
    tools(call("propose_order", "{not json")),
    tools(call("finish", { summary: "gave up" })),
  ]);
  const r = await runShoppingAgent(deps, { mandateId: id });
  expect(r.outcome).toBe("finished");
  const last = must(model.seen[1]?.messages.at(-1), "last message");
  expect(last.role).toBe("tool");
  expect(last.content).toContain("invalid arguments");
});

test("model failure gives outcome error", async () => {
  const { deps, id } = await setup([]);
  expect(await runShoppingAgent(deps, { mandateId: id })).toMatchObject({
    steps: 0,
    outcome: "error",
  });
});

test("withDemoInjection puts the trap first and delegates the rest", async () => {
  const base = new FakeProductSearch(
    [{ productId: "a", title: "A", offers: [], options: {}, description: "" }],
    [good],
  );
  const s = withDemoInjection(base);
  const found = await s.search({ query: "x", limit: 5 });
  expect(found.map((p) => p.productId)).toEqual(["demo-trap-1", "a"]);
  expect(await s.resolveOffer({ productId: "p72", merchant: "shop.test", options: {} })).toEqual(
    good,
  );
  expect(
    (await s.resolveOffer({ productId: "demo-trap-1", merchant: "x", options: {} }))?.price,
  ).toEqual(usd(14000));
});

test("a throwing proposeOrder is audited and returns outcome error", async () => {
  const { deps, repo, id } = await setup([
    tools(
      call("propose_order", { product_id: "p72", merchant: "shop.test", options: { Size: "10" } }),
    ),
  ]);
  const boom = {
    ...deps,
    search: {
      search: deps.search.search,
      resolveOffer: async () => {
        throw new Error("catalog down");
      },
    },
  };
  const spy = console.error;
  console.error = () => {};
  const r = await runShoppingAgent(boom, { mandateId: id }).finally(() => {
    console.error = spy;
  });
  expect(r).toMatchObject({ outcome: "error", summary: "catalog down" });
  const last = must((await repo.listAudit(id)).at(-1), "last audit entry");
  expect(last.kind).toBe("agent_step");
  expect(last.message.startsWith("Agent stopped with an error")).toBe(true);
});

test("an unknown tool name is reported, with valid or garbage JSON", async () => {
  const { deps, model, id } = await setup([
    tools(call("rm_rf", { x: 1 }, "a"), call("rm_rf", "{garbage", "b")),
    tools(call("finish", { summary: "ok" })),
  ]);
  expect((await runShoppingAgent(deps, { mandateId: id })).outcome).toBe("finished");
  const results = model.seen[1]?.messages.filter((m) => m.role === "tool").map((m) => m.content);
  expect(results).toEqual(['{"error":"unknown tool rm_rf"}', '{"error":"unknown tool rm_rf"}']);
});
