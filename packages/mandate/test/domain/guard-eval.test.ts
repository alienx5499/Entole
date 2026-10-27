import { expect, test } from "bun:test";
import { evaluate } from "./guard-eval.ts";

for (const r of evaluate())
  test(`guard eval: ${r.expect} ${r.name}`, () => {
    expect(r.verdict.kind).toBe(r.expect);
  });
