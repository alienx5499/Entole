import { expect, test } from "bun:test";
import { type InMemoryIdempotencyStore, ScriptedAgentModel } from "@entole/testing";
import { body, harness, login, NOW } from "./harness.ts";

const SHORTLIST = JSON.stringify({
  items: [{ product_id: "p1", merchant: "shop.example", options: { Size: "10" } }],
});
// The scripted model answers once; give it one more turn for each extra real create.
const moreTurns = (h: ReturnType<typeof harness>, n = 1) => {
  h.c.model = new ScriptedAgentModel(
    Array.from({ length: n }, (_, i) => ({
      kind: "tools" as const,
      calls: [{ id: `c${i}`, name: "shortlist", argsJson: SHORTLIST }],
    })),
  );
};
const create = (h: ReturnType<typeof harness>, cookie: string, key?: string, over = {}) =>
  h.call("/api/mandates", {
    method: "POST",
    body: body(over),
    cookie,
    headers: key === undefined ? {} : { "idempotency-key": key },
  });

test("the same key and body replays the first answer without running again", async () => {
  const h = harness();
  const cookie = await login(h);
  const first = await create(h, cookie, "k-1");
  expect(first.status).toBe(200);
  expect(first.headers.get("idempotent-replayed")).toBeNull();
  const again = await create(h, cookie, "k-1");
  expect(again.status).toBe(200);
  expect(again.headers.get("idempotent-replayed")).toBe("true");
  expect(again.headers.get("content-type")).toBe("application/json");
  expect(await again.json()).toEqual(await first.json());
  expect(h.gateway.orders).toHaveLength(1);
});

test("the same key with another body or route is 422 idempotency_key_reused", async () => {
  const h = harness();
  const cookie = await login(h);
  const first = await create(h, cookie, "k-1");
  const { id } = (await first.json()) as { id: string };
  const other = await create(h, cookie, "k-1", { limitPrice: "160.00" });
  expect(other.status).toBe(422);
  expect(await other.json()).toEqual({ error: "idempotency_key_reused" });
  const close = await h.call(`/api/mandates/${id}/close`, {
    method: "POST",
    cookie,
    headers: { "idempotency-key": "k-1" },
  });
  expect(close.status).toBe(422);
  expect(h.gateway.orders).toHaveLength(1);
});

test("a duplicate sent while the first is running is 409 idempotency_in_progress", async () => {
  const h = harness();
  const cookie = await login(h);
  const [a, b] = await Promise.all([create(h, cookie, "k-1"), create(h, cookie, "k-1")]);
  expect([a?.status, b?.status].sort()).toEqual([200, 409]);
  const busy = a?.status === 409 ? a : b;
  expect(await busy?.json()).toEqual({ error: "idempotency_in_progress" });
  expect(busy?.headers.get("retry-after")).toBe("2");
  expect(h.gateway.orders).toHaveLength(1);
});

test("a key left in flight by a dead request frees itself after the 5 minute lease", async () => {
  const h = harness();
  const cookie = await login(h);
  const lease = { route: "POST /api/mandates", bodyHash: "dead", response: null };
  const store = h.c.idempotency as InMemoryIdempotencyStore;
  store.rows.set("user-1\nk-1", {
    ...lease,
    expiresAt: new Date(NOW.getTime() + 300_000),
    claimId: "dead",
  });
  h.clock.advance(300_000 - 1);
  expect((await create(h, cookie, "k-1")).status).toBe(422);
  h.clock.advance(1);
  const res = await create(h, cookie, "k-1");
  expect(res.status).toBe(200);
  // Once answered, the key is kept for a day from then, not just the lease.
  h.clock.advance(24 * 3600_000 - 1);
  expect((await create(h, cookie, "k-1")).headers.get("idempotent-replayed")).toBe("true");
});

test("a request that outlived its lease cannot overwrite or free the key's new holder", async () => {
  const h = harness();
  const cookie = await login(h);
  const store = h.c.idempotency as InMemoryIdempotencyStore;
  const route = "POST /api/mandates";
  const slow = await store.claim(
    { callerId: "user-1", key: "k-1", route, bodyHash: "x", expiresAt: NOW },
    NOW,
  );
  const first = await create(h, cookie, "k-1");
  expect(first.status).toBe(200);
  const stale = (slow as { claimId: string }).claimId;
  await store.complete("user-1", "k-1", stale, { status: 500, body: "{}" }, new Date(9e15));
  await store.release("user-1", "k-1", stale);
  const replay = await create(h, cookie, "k-1");
  expect(replay.headers.get("idempotent-replayed")).toBe("true");
  expect(await replay.json()).toEqual(await first.json());
});

test("keys are scoped per caller: another user's same key runs fresh", async () => {
  const h = harness();
  const alice = await login(h, "alice");
  const bob = await login(h, "bob");
  const first = (await (await create(h, alice, "shared")).json()) as { id: string };
  moreTurns(h);
  const res = await create(h, bob, "shared");
  expect(res.status).toBe(200);
  expect(res.headers.get("idempotent-replayed")).toBeNull();
  const second = (await res.json()) as { id: string };
  expect(second.id).not.toBe(first.id);
  expect(h.gateway.orders).toHaveLength(2);
});

test("a key expires after 24 hours and then runs again", async () => {
  const h = harness();
  const cookie = await login(h);
  await create(h, cookie, "k-1");
  h.clock.advance(24 * 3600_000 - 1);
  expect((await create(h, cookie, "k-1")).headers.get("idempotent-replayed")).toBe("true");
  h.clock.advance(1);
  moreTurns(h);
  const res = await create(h, cookie, "k-1");
  expect(res.status).toBe(200);
  expect(res.headers.get("idempotent-replayed")).toBeNull();
  expect(h.gateway.orders).toHaveLength(2);
});

test("without a key every call runs, as before", async () => {
  const h = harness();
  const cookie = await login(h);
  await create(h, cookie);
  moreTurns(h);
  const res = await create(h, cookie);
  expect(res.status).toBe(200);
  expect(res.headers.get("idempotent-replayed")).toBeNull();
  expect(h.gateway.orders).toHaveLength(2);
  expect((h.c.idempotency as InMemoryIdempotencyStore).rows.size).toBe(0);
});

test("a malformed key is 400 and a failed request frees its key", async () => {
  const h = harness();
  const cookie = await login(h);
  for (const key of ["x".repeat(256), "has space", "é"]) {
    const res = await create(h, cookie, key);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_idempotency_key" });
  }
  expect((await create(h, cookie, "x".repeat(255))).status).toBe(200);
  const missing = () =>
    h.call("/api/mandates/nope/close", {
      method: "POST",
      cookie,
      headers: { "idempotency-key": "k-close" },
    });
  expect((await missing()).status).toBe(404);
  expect((await missing()).status).toBe(404);
  expect((h.c.idempotency as InMemoryIdempotencyStore).rows.has("user-1\nk-close")).toBe(false);
});

test("an unauthenticated call with a key is still 401, even with a malformed key", async () => {
  const h = harness();
  expect((await create(h, "", "k-1")).status).toBe(401);
  expect((await create(h, "", "has space")).status).toBe(401);
});
