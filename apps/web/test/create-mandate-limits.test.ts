/// <reference types="bun" />
import { expect, test } from "bun:test";
import { daysBetween, MAX_VALID_DAYS } from "../src/features/create-mandate/limits";

const window = (days: number) => ({
  createdAt: "2026-10-01T00:00:00.000Z",
  validUntil: new Date(Date.parse("2026-10-01T00:00:00.000Z") + days * 86_400_000).toISOString(),
});

test("an edited order keeps a window longer than 3 days", () => {
  expect(daysBetween(window(10))).toBe(10);
  expect(daysBetween(window(29))).toBe(29);
});

test("the window is clamped to 1 and the longest a limit order may run", () => {
  expect(daysBetween(window(0))).toBe(1);
  expect(daysBetween(window(40))).toBe(MAX_VALID_DAYS);
});
