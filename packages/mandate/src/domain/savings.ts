import { type Money, usd } from "@entole/shared-kernel";

export const savingsFor = (capturedPrice: Money, baselinePrice: Money): Money =>
  usd(Math.max(0, baselinePrice.cents - capturedPrice.cents));
