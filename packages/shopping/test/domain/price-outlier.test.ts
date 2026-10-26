import { expect, test } from "bun:test";
import { usd } from "@entole/shared-kernel";
import { priceOutlierDetail } from "../../src/index.ts";

const peers = (...c: number[]) => c.map(usd);

test("an offer under half the median of its peers is flagged", () => {
  expect(priceOutlierDetail(usd(4900), peers(17000, 18000, 19000))).toBe(
    "$49.00 is far below the usual $180.00 for this product",
  );
});
test("a normal spread is not flagged", () => {
  expect(priceOutlierDetail(usd(9000), peers(17000, 18000, 19000))).toBeNull();
  expect(priceOutlierDetail(usd(9000), peers(18000, 18000, 18000))).toBeNull();
});
test("fewer than 2 peers are not judged", () => {
  expect(priceOutlierDetail(usd(100), peers(18000))).toBeNull();
  expect(priceOutlierDetail(usd(100), [])).toBeNull();
});
test("a listing with too few peers is compared with the other products in the search", () => {
  expect(priceOutlierDetail(usd(500), peers(), peers(17000, 17300, 18000))).toBe(
    "$5.00 is far below the usual $173.00 for similar items in this search",
  );
  expect(priceOutlierDetail(usd(16000), peers(), peers(17000, 17300, 18000))).toBeNull();
  // Fewer than 3 similar items are not enough to judge.
  expect(priceOutlierDetail(usd(500), peers(), peers(17000, 18000))).toBeNull();
  // Same-product sellers win over similar items when there are enough of them.
  expect(
    priceOutlierDetail(usd(9000), peers(17000, 18000), peers(100000, 100000, 100000)),
  ).toBeNull();
});
