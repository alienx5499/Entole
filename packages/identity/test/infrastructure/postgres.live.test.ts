import { expect, test } from "bun:test";
import { LIVE, useLivePostgres } from "@entole/testing";
import {
  PostgresApiTokenRepository,
  PostgresIdempotencyStore,
  PostgresSessionRepository,
  PostgresUserRepository,
} from "../../src/index.ts";

const live = LIVE ? test : test.skip;
const db = useLivePostgres();
const now = new Date("2026-10-26T10:00:00.000Z");

live(
  "users and sessions",
  async () => {
    const users = new PostgresUserRepository(db());
    const u1 = await users.upsertByPaypalId({ paypalUserId: "pp1", email: "a@x.com", name: "A" });
    const u2 = await users.upsertByPaypalId({ paypalUserId: "pp1", email: "b@x.com", name: "B" });
    expect(u2.id).toBe(u1.id);
    expect(await users.get(u1.id)).toEqual({ ...u1, email: "b@x.com", name: "B" });
    expect(await users.get("nope")).toBeNull();

    const sessions = new PostgresSessionRepository(db());
    const token = await sessions.create(u1.id, new Date(now.getTime() + 3600_000));
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const [stored] = await db()`select token from sessions`;
    expect(stored.token).not.toBe(token);
    expect(await sessions.userIdFor(token, now)).toBe(u1.id);
    expect(await sessions.userIdFor(token, new Date(now.getTime() + 7200_000))).toBeNull();
    await sessions.revoke(token);
    expect(await sessions.userIdFor(token, now)).toBeNull();
  },
  60_000,
);

live(
  "api tokens",
  async () => {
    const tokens = new PostgresApiTokenRepository(db());
    await tokens.create({ id: "tok1", userId: "u1", name: "Claude", hash: "h1", createdAt: now });
    expect(await tokens.use("h1", now)).toBe("u1");
    const [t] = await tokens.listByUser("u1");
    expect(t).toEqual({
      id: "tok1",
      name: "Claude",
      createdAt: now,
      lastUsedAt: now,
      revokedAt: null,
    });
    const later = (ms: number) => new Date(now.getTime() + ms);
    expect(await tokens.use("h1", later(59_000))).toBe("u1"); // still resolves, stamp unchanged
    expect((await tokens.listByUser("u1"))[0]?.lastUsedAt).toEqual(now);
    expect(await tokens.use("h1", later(61_000))).toBe("u1");
    expect((await tokens.listByUser("u1"))[0]?.lastUsedAt).toEqual(later(61_000));
    expect(await tokens.revoke("u2", "tok1", now)).toBe(false);
    expect(await tokens.revoke("u1", "tok1", now)).toBe(true);
    expect(await tokens.use("h1", now)).toBeNull();
    expect((await tokens.listByUser("u1"))[0]?.revokedAt).toEqual(now);
  },
  60_000,
);

live(
  "idempotency keys",
  async () => {
    const store = new PostgresIdempotencyStore(db());
    const later = new Date(now.getTime() + 86_400_000);
    const r = {
      callerId: "u1",
      key: "k",
      route: "POST /api/mandates",
      bodyHash: "h",
      expiresAt: later,
    };
    const claimId = (c: unknown) => (c as { claimId: string }).claimId;
    const u1 = claimId(await store.claim(r, now));
    expect(u1).toBeString();
    expect(await store.claim(r, now)).toEqual({
      held: { route: r.route, bodyHash: "h", response: null },
    });
    const u2 = claimId(await store.claim({ ...r, callerId: "u2" }, now));
    await store.release("u2", "k", "not-the-claim");
    expect(await store.claim({ ...r, callerId: "u2" }, now)).toHaveProperty("held");
    await store.release("u2", "k", u2);
    await store.complete("u1", "k", "not-the-claim", { status: 500, body: "stale" }, later);
    await store.complete("u1", "k", u1, { status: 200, body: "{}" }, later);
    await store.release("u1", "k", u1);
    expect(await store.claim(r, now)).toEqual({
      held: { route: r.route, bodyHash: "h", response: { status: 200, body: "{}" } },
    });
    expect(await store.claim({ ...r, callerId: "u2" }, now)).toHaveProperty("claimId");
    expect(
      await store.claim({ ...r, expiresAt: new Date(later.getTime() + 1) }, later),
    ).toHaveProperty("claimId");
  },
  60_000,
);
