import { expect, test } from "bun:test";
import { LIVE, useLivePostgres } from "@entole/testing";
import {
  PostgresApiTokenRepository,
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
    expect(await tokens.revoke("u2", "tok1", now)).toBe(false);
    expect(await tokens.revoke("u1", "tok1", now)).toBe(true);
    expect(await tokens.use("h1", now)).toBeNull();
    expect((await tokens.listByUser("u1"))[0]?.revokedAt).toEqual(now);
  },
  60_000,
);
