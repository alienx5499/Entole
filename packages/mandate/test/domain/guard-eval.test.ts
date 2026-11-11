import { expect, test } from "bun:test";
import { evaluate } from "./guard-eval.ts";

for (const r of evaluate())
  test(`guard eval: ${r.expect} ${r.name}`, () => {
    expect(r.verdict.kind).toBe(r.expect);
  });

// The README quotes this number; the eval prints it next to the real guard's score.
test("guard eval: an amount-only guard pays 14 of the 17 attacks", () => {
  const attacks = evaluate().filter((r) => r.expect === "block");
  expect(attacks.filter((r) => r.baseline === "allow")).toHaveLength(14);
});
