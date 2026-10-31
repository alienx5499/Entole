import { expect, test } from "bun:test";
import { formatUsd, parseUsd, sub, usd, usdFromDollars } from "../src/money.ts";

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
test("usdFromDollars rounds a float to cents and rejects what parseUsd would", () => {
  expect(usdFromDollars(149.99)).toEqual(usd(14999));
  expect(usdFromDollars(160)).toEqual(usd(16000));
  expect(usdFromDollars(0)).toEqual(usd(0));
  for (const bad of [-0.01, -1, Number.NaN, Number.POSITIVE_INFINITY])
    expect(() => usdFromDollars(bad)).toThrow(RangeError);
});
