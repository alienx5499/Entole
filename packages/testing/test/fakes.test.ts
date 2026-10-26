import { expect, test } from "bun:test";
import { InMemoryMandateRepository } from "../src/index.ts";

test("InMemoryMandateRepository links orders and keeps audit order", async () => {
  const repo = new InMemoryMandateRepository();
  const m = { id: "m1" } as never;
  await repo.save(m);
  await repo.linkOrder("m1", "o1", "https://paypal.test/approve/o1");
  expect(await repo.findByOrderId("o1")).toBe(m);
  expect(await repo.approveUrlFor("m1")).toBe("https://paypal.test/approve/o1");
  expect(await repo.approveUrlFor("nope")).toBeNull();
  expect(await repo.findByOrderId("nope")).toBeNull();
  await repo.appendAudit("m1", { kind: "a" } as never);
  await repo.appendAudit("m1", { kind: "b" } as never);
  expect((await repo.listAudit("m1")).map((e) => (e as never as { kind: string }).kind)).toEqual([
    "a",
    "b",
  ]);
});
