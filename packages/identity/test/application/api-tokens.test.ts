import { expect, test } from "bun:test";
import { FixedClock, InMemoryApiTokenRepository, SequentialIds } from "@entole/testing";
import {
  authenticateApiToken,
  generateApiToken,
  hashApiToken,
  isApiTokenShape,
  issueApiToken,
  MAX_LIVE_TOKENS,
  MAX_TOKEN_NAME,
} from "../../src/index.ts";

const now = new Date("2026-10-26T10:00:00.000Z");
const setup = () => {
  const apiTokens = new InMemoryApiTokenRepository();
  return { apiTokens, ids: new SequentialIds(), clock: new FixedClock(now) };
};

test("tokens are ent_ plus 32 random bytes and hash to sha256 hex", () => {
  const t = generateApiToken();
  expect(t).toMatch(/^ent_[A-Za-z0-9_-]{43}$/);
  expect(isApiTokenShape(t)).toBe(true);
  expect(generateApiToken()).not.toBe(t);
  expect(hashApiToken("ent_x")).toBe(new Bun.CryptoHasher("sha256").update("ent_x").digest("hex"));
  expect(isApiTokenShape("ent_short")).toBe(false);
  expect(isApiTokenShape(`xyz_${t.slice(4)}`)).toBe(false);
});

test("issue stores only the hash; authenticate stamps last use; revoked is rejected", async () => {
  const deps = setup();
  const issued = await issueApiToken(deps, "u1", "Claude Desktop");
  if (issued.outcome !== "issued") throw new Error(issued.outcome);
  const { id, token } = issued;
  const row = deps.apiTokens.rows.get(id);
  expect(row?.hash).toBe(hashApiToken(token));
  expect(JSON.stringify(row)).not.toContain(token);
  expect(row?.lastUsedAt).toBeNull();

  expect(await authenticateApiToken(deps, token)).toBe("u1");
  expect(row?.lastUsedAt).toEqual(now);
  // Within a minute the stamp is left alone; after it, it moves on.
  deps.clock.advance(59_000);
  expect(await authenticateApiToken(deps, token)).toBe("u1");
  expect(row?.lastUsedAt).toEqual(now);
  deps.clock.advance(2_000);
  expect(await authenticateApiToken(deps, token)).toBe("u1");
  expect(row?.lastUsedAt).toEqual(new Date(now.getTime() + 61_000));
  expect(await authenticateApiToken(deps, generateApiToken())).toBeNull();
  expect(await authenticateApiToken(deps, "not-a-token")).toBeNull();

  expect(await deps.apiTokens.revoke("u2", id, now)).toBe(false);
  expect(await deps.apiTokens.revoke("u1", id, now)).toBe(true);
  expect(await deps.apiTokens.revoke("u1", id, now)).toBe(false);
  expect(await authenticateApiToken(deps, token)).toBeNull();
});

test("a token name is trimmed and must be 1 to MAX_TOKEN_NAME characters", async () => {
  const deps = setup();
  expect(await issueApiToken(deps, "u1", "   ")).toEqual({ outcome: "invalid_name" });
  expect(await issueApiToken(deps, "u1", "x".repeat(MAX_TOKEN_NAME + 1))).toEqual({
    outcome: "invalid_name",
  });
  const issued = await issueApiToken(deps, "u1", ` ${"x".repeat(MAX_TOKEN_NAME)} `);
  if (issued.outcome !== "issued") throw new Error(issued.outcome);
  expect(deps.apiTokens.rows.get(issued.id)?.name).toBe("x".repeat(MAX_TOKEN_NAME));
});

test("a user holds at most MAX_LIVE_TOKENS live tokens; a revoked one frees a place", async () => {
  const deps = setup();
  const ids: string[] = [];
  for (let n = 0; n < MAX_LIVE_TOKENS; n++) {
    const issued = await issueApiToken(deps, "u1", `t${n}`);
    if (issued.outcome !== "issued") throw new Error(issued.outcome);
    ids.push(issued.id);
  }
  expect(await issueApiToken(deps, "u1", "one more")).toEqual({ outcome: "too_many_tokens" });
  expect((await issueApiToken(deps, "u2", "other user")).outcome).toBe("issued");
  await deps.apiTokens.revoke("u1", ids[0] ?? "", now);
  expect((await issueApiToken(deps, "u1", "one more")).outcome).toBe("issued");
});
