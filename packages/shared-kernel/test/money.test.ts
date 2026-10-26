import { expect, test } from "bun:test";
import { formatUsd, parseUsd, sub, usd } from "../src/money.ts";

test("parseUsd and formatUsd", () => {
  expect(parseUsd("79.98").cents).toBe(7998);
  expect(formatUsd(usd(8000))).toBe("80.00");
  expect(formatUsd(usd(7998))).toBe("79.98");
});
test("rejects bad input", () => {
  expect(() => parseUsd("1.234")).toThrow();
  expect(() => sub(usd(100), usd(200))).toThrow();
  expect(() => usd(1.5)).toThrow();
  expect(() => usd(-1)).toThrow();
});
