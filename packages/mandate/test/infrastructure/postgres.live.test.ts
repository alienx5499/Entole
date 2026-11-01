import { expect, test } from "bun:test";
import { usd } from "@entole/shared-kernel";
import { LIVE, useLivePostgres } from "@entole/testing";
import { newMandate, PostgresMandateRepository } from "../../src/index.ts";

const live = LIVE ? test : test.skip;
const db = useLivePostgres();

const now = new Date("2026-10-26T10:00:00.000Z");
const mandate = (id: string, kind: "standard" | "limit") =>
  newMandate({
    id,
    ownerId: "u1",
    now,
    terms: {
      kind,
      item: { query: "shoes", requiredAttributes: {}, brands: [], avoid: [] },
      candidates: [
        {
          productId: "p1",
          merchant: "shoes.example",
          options: {},
          title: "Shoe",
          baselinePrice: usd(7998),
        },
      ],
      maxUnitPrice: usd(8000),
      budget: usd(8000),
      allowedMerchants: [],
      validUntil: new Date("2026-10-27T10:00:00.000Z"),
    },
  });

live(
  "mandates: save, get, order link, listFundedLimit, audit",
  async () => {
    const repo = new PostgresMandateRepository(db());
    const a = mandate("m-a", "limit");
    const b = mandate("m-b", "standard");
    await repo.save(a);
    await repo.save(b);
    expect(await repo.get("m-a")).toEqual(a);
    expect(await repo.get("nope")).toBeNull();
    await repo.linkOrder("m-a", "ORDER-1", "https://paypal.test/approve/ORDER-1");
    expect((await repo.findByOrderId("ORDER-1"))?.id).toBe("m-a");
    expect(await repo.approveUrlFor("m-a")).toBe("https://paypal.test/approve/ORDER-1");
    expect(await repo.approveUrlFor("m-b")).toBeNull();
    await expect(repo.linkOrder("ghost", "ORDER-2", "https://paypal.test/x")).rejects.toThrow(
      "unknown mandate",
    );

    const funded = {
      ...a,
      status: "funded" as const,
      authorization: { id: "AUTH", amount: usd(8000), expiresAt: new Date("2026-11-24T00:00:00Z") },
    };
    await repo.save(funded); // upsert keeps the order link
    expect((await repo.findByOrderId("ORDER-1"))?.status).toBe("funded");
    await repo.save({ ...b, status: "funded" });
    expect((await repo.listFundedLimit()).map((m) => m.id)).toEqual(["m-a"]);
    expect((await repo.listFundedLimit())[0]).toEqual(funded);

    await repo.appendAudit("m-a", { at: now, kind: "created", message: "one", data: { k: "v" } });
    await repo.appendAudit("m-a", { at: now, kind: "funded", message: "two" });
    expect(await repo.listAudit("m-a")).toEqual([
      { at: now, kind: "created", message: "one", data: { k: "v" } },
      { at: now, kind: "funded", message: "two" },
    ]);
    const blocked = (message: string, merchant: string) =>
      repo.appendAudit("m-a", {
        at: now,
        kind: "proposal_blocked",
        message,
        data: { productId: "p1", merchant },
      });
    await blocked("old", "shoes.example");
    await blocked("new", "shoes.example");
    await blocked("other shop", "b.example");
    expect((await repo.lastBlocked("m-a", "p1", "shoes.example"))?.message).toBe("new");
    expect(await repo.lastBlocked("m-a", "p2", "shoes.example")).toBeNull();
    const all = await repo.listAuditFor(["m-a", "m-b"]);
    expect(all.get("m-a")).toEqual(await repo.listAudit("m-a"));
    expect(all.get("m-b")).toEqual([]);
    expect(await repo.listAuditFor([])).toEqual(new Map());
    const old = new Date(now.getTime() - 7 * 3_600_000);
    await repo.appendAudit("m-a", { at: old, kind: "channel3_noted", message: "stale" });
    await repo.appendAudit("m-a", { at: now, kind: "channel3_noted", message: "fresh" });
    const recent = await repo.recentNotes(["m-a", "m-b"], new Date(now.getTime() - 3_600_000));
    expect(recent.get("m-a")?.map((e) => e.message)).toEqual(["fresh"]);
    expect(recent.get("m-b")).toEqual([]);
  },
  60_000,
);

live(
  "mandates: countCreatedSince per owner and overall",
  async () => {
    const repo = new PostgresMandateRepository(db());
    const since = new Date(now.getTime() - 1);
    const before = await repo.countCreatedSince(since);
    await repo.save({ ...mandate("m-count-1", "limit"), ownerId: "u-count" });
    await repo.save({ ...mandate("m-count-2", "limit"), ownerId: "u-other" });
    expect(await repo.countCreatedSince(since, "u-count")).toBe(1);
    expect(await repo.countCreatedSince(since)).toBe(before + 2);
    expect(await repo.countCreatedSince(new Date(now.getTime() + 1), "u-count")).toBe(0);
  },
  30_000,
);

live(
  "mandates: listFundedLimitForProduct",
  async () => {
    const repo = new PostgresMandateRepository(db());
    const funded = (id: string, kind: "standard" | "limit", productId = "p1") => {
      const m = mandate(id, kind);
      const [c] = m.terms.candidates;
      if (!c) throw new Error("fixture has a candidate");
      return {
        ...m,
        status: "funded" as const,
        terms: { ...m.terms, candidates: [{ ...c, productId }] },
      };
    };
    const watching = funded("m-watch", "limit");
    await repo.save(watching);
    await repo.save({ ...funded("m-exhausted", "limit"), status: "exhausted" });
    await repo.save(funded("m-standard", "standard"));
    await repo.save(funded("m-other", "limit", "p2"));
    expect(await repo.listFundedLimitForProduct("p1")).toEqual([watching]);
    expect(await repo.listFundedLimitForProduct("p3")).toEqual([]);
  },
  30_000,
);
