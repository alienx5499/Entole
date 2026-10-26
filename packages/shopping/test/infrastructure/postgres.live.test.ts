import { expect, test } from "bun:test";
import { LIVE, useLivePostgres } from "@entole/testing";
import { PostgresTasteRepository } from "../../src/index.ts";

const live = LIVE ? test : test.skip;
const db = useLivePostgres();

live(
  "taste: upsert and read back per user",
  async () => {
    const taste = new PostgresTasteRepository(db());
    expect(await taste.get("user-1")).toBeNull();
    const t = { brands: ["On"], avoid: ["x"], attributes: { Size: "10" } };
    await taste.save("user-1", t);
    await taste.save("user-1", t);
    expect(await taste.get("user-1")).toEqual(t);
  },
  60_000,
);
