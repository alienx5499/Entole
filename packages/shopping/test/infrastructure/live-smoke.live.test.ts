import { expect, test } from "bun:test";
import { usd } from "@entole/shared-kernel";
import { readEnv } from "@entole/testing";
import { AGENT_TOOLS, Channel3Search, GroqAgentModel } from "../../src/index.ts";

const live = process.env.LIVE === "1" ? test : test.skip;

live(
  "Channel3 search returns a product at or under $80",
  async () => {
    const search = new Channel3Search({ apiKey: readEnv("CHANNEL3_API_KEY") });
    const out = await search.search({ query: "mens running shoes", maxPrice: usd(8000), limit: 5 });
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out.some((p) => p.offers.some((o) => o.price.cents <= 8000))).toBe(true);
  },
  30_000,
);

live(
  "Groq answers with tools or final",
  async () => {
    const model = new GroqAgentModel({
      apiKeys: [readEnv("GROQ_API_KEY")],
      model: process.env.GROQ_MODEL,
    });
    const turn = await model.next(
      [{ role: "user", content: "Find mens running shoes under $80." }],
      AGENT_TOOLS,
    );
    expect(["tools", "final"]).toContain(turn.kind);
  },
  60_000,
);
