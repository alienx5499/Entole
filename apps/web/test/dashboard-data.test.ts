/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import {
  explainSavings,
  kpis,
  mapLimit,
  toOrderRow,
  toPriceRows,
} from "../src/features/dashboard/dashboard-data";
import type { MandateView, PricesResponse } from "../src/shared/api/types";

const view = (over: Partial<MandateView>): MandateView =>
  ({
    id: "m1",
    outcome: "watching",
    createdAt: "2026-10-20T10:00:00.000Z",
    validUntil: "2026-10-27T10:00:00.000Z",
    terms: { query: "trail shoes", limitPrice: "80.00" },
    candidates: [{ merchant: "Fleet Feet" }],
    held: "80.00",
    captured: "0.00",
    purchase: null,
    ...over,
  }) as MandateView;

const bought = view({
  id: "m2",
  outcome: "bought",
  captured: "72.50",
  purchase: { merchant: "REI", title: "Speedgoat", savings: "17.49" } as MandateView["purchase"],
});

describe("dashboard rows", () => {
  test("a watching order holds money; a bought one counts paid and saved", () => {
    const w = toOrderRow(view({}));
    expect(w).toMatchObject({ heldNow: 80, spent: 0, saved: 0, shop: "Fleet Feet" });
    expect(w.createdAt).toBe("2026-10-20");
    expect(toOrderRow(bought)).toMatchObject({ heldNow: 0, paid: 72.5, spent: 72.5, saved: 17.49 });
  });

  test("a refunded capture is paid but not spent", () => {
    const r = toOrderRow(view({ outcome: "refunded", captured: "50.00", held: "60.00" }));
    expect(r).toMatchObject({ paid: 50, spent: 0, heldNow: 0, isBought: 0 });
  });

  test("kpis add up without float drift", () => {
    const rows = [
      toOrderRow(view({})),
      toOrderRow(bought),
      toOrderRow({ ...bought, id: "m3", captured: "0.10" }),
      toOrderRow(view({ id: "m4", outcome: "released", held: "40.00" })),
    ];
    expect(kpis(rows)).toEqual({
      orders: 4,
      held: 80,
      spent: 72.6,
      saved: 34.98,
      bought: 2,
      released: 1,
    });
  });

  test("a replay only includes points it has reached", () => {
    const prices = {
      candidates: [
        {
          productId: "p1",
          title: "Speedgoat",
          limit: "80.00",
          currentIndex: 1,
          points: [
            { at: "a", price: "90.00" },
            { at: "b", price: "85.00" },
            { at: "c", price: "70.00" },
          ],
        },
      ],
    } as PricesResponse;
    expect(toPriceRows("m1", prices).map((p) => p.price)).toEqual([90, 85]);
  });
});

describe("explainSavings", () => {
  test("names the biggest win and the money still held", () => {
    const text = explainSavings([toOrderRow(view({})), toOrderRow(bought)]);
    expect(text).toContain("You saved $17.49 across 1 bought order");
    expect(text).toContain('"trail shoes" at REI');
    expect(text).toContain("$80.00 is still on hold");
  });

  test("says so when nothing has bought", () => {
    expect(explainSavings([])).toContain("no limit orders yet");
    expect(explainSavings([toOrderRow(view({}))])).toContain("nothing is saved");
  });
});

test("mapLimit keeps order and never exceeds the limit", async () => {
  let live = 0;
  let peak = 0;
  const out = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
    live++;
    peak = Math.max(peak, live);
    await new Promise((r) => setTimeout(r, 5));
    live--;
    return n * 10;
  });
  expect(out).toEqual([10, 20, 30, 40, 50, 60]);
  expect(peak).toBe(2);
});
