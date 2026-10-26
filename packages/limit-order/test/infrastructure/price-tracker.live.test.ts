import { expect, test } from "bun:test";
import { readEnv } from "@entole/shared-kernel";
import { Channel3Search } from "@entole/shopping";
import { Channel3PriceTracker } from "../../src/index.ts";

const live = process.env.LIVE === "1" ? test : test.skip;

live(
  "start tracking a searched product, then read its price history",
  async () => {
    const apiKey = readEnv("CHANNEL3_API_KEY");
    const [product] = await new Channel3Search({ apiKey }).search({
      query: "mens running shoes",
      limit: 1,
    });
    if (!product) throw new Error("search returned nothing");
    const tracker = new Channel3PriceTracker({ apiKey });
    await tracker.start(product.productId);
    const points = await tracker.history(product.productId, 7);
    expect(points.length).toBeGreaterThan(0);
    expect(points[0]?.at).toBeInstanceOf(Date);
    expect(points[0]?.price.cents).toBeGreaterThan(0);
  },
  30_000,
);
