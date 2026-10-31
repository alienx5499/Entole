import { createHash } from "node:crypto";
import { requireCaller } from "../routes/auth.ts";
import { HttpError } from "./http.ts";
import type { Route } from "./router.ts";

// Printable ASCII without spaces; the generated SDK sends a UUID.
const KEY = /^[\x21-\x7e]{1,255}$/;
const TTL_MS = 86_400_000;
// How long a running request holds its key. It must exceed Bun's idleTimeout (120 s in main.ts) so
// a live request is never run a second time; a key left by a crashed process frees itself after it.
const LEASE_MS = 300_000;

// Honours the Idempotency-Key the generated SDK sends on every non-GET call: a retry with the same
// key and body gets the first answer back instead of running twice. No key: the route runs as is.
export const idempotent =
  (handler: Route[2]): Route[2] =>
  async (ctx) => {
    const key = ctx.req.headers.get("idempotency-key");
    if (key === null) return handler(ctx);
    const callerId = await requireCaller(ctx);
    if (!KEY.test(key)) throw new HttpError(400, "invalid_idempotency_key");
    const route = `${ctx.req.method} ${ctx.url.pathname.replace(/\/+$/, "")}`;
    const bodyHash = createHash("sha256")
      .update(await ctx.req.clone().text())
      .digest("hex");
    const store = ctx.c.idempotency;
    const now = ctx.c.clock.now();
    const expiresAt = new Date(now.getTime() + LEASE_MS);
    const claim = await store.claim({ callerId, key, route, bodyHash, expiresAt }, now);
    if ("held" in claim) {
      const { held } = claim;
      if (held.route !== route || held.bodyHash !== bodyHash)
        throw new HttpError(422, "idempotency_key_reused");
      if (!held.response)
        throw new HttpError(409, "idempotency_in_progress", {}, { "Retry-After": "2" });
      return new Response(held.response.body, {
        status: held.response.status,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          "Idempotent-Replayed": "true",
        },
      });
    }
    let res: Response;
    try {
      res = await handler(ctx);
    } catch (err) {
      await store.release(callerId, key, claim.claimId).catch((e: unknown) => console.error(e));
      throw err;
    }
    // The answer already happened; a failed save must not turn it into an error.
    await store
      .complete(
        callerId,
        key,
        claim.claimId,
        { status: res.status, body: await res.clone().text() },
        new Date(ctx.c.clock.now().getTime() + TTL_MS),
      )
      .catch((e: unknown) => console.error(e));
    return res;
  };
