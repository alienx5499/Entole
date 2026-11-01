import {
  InvalidOfferEvent,
  mandatesToWake,
  recordNotes,
  recordWakes,
  translateChannel3Event,
} from "@entole/limit-order";
import { HttpError, json, readCapped } from "../http/http.ts";
import { clientIp } from "../http/rate-limit.ts";
import type { Route } from "../http/router.ts";
import { verifySvix } from "../http/svix.ts";

// It can never parse, so Svix is told to stop the retries it would make for about 30 hours.
// Documented by Svix (docs.svix.com/retries) and Channel3 (channel3.ai/docs/product-subscription-webhooks).
const ABORT = { "webhook-delivery": "abort-message" };

const translate = (raw: string) => {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "invalid_json", {}, ABORT);
  }
  try {
    return translateChannel3Event(body);
  } catch (err) {
    if (err instanceof InvalidOfferEvent) {
      // Id and type only: the payload stays out of the logs.
      const { id, type } = (body ?? {}) as { id?: unknown; type?: unknown };
      console.error(`channel3 event ${String(id)} (${String(type)}) is invalid, delivery aborted`);
      throw new HttpError(400, "invalid_event", {}, ABORT);
    }
    throw err;
  }
};

// No session: Channel3 calls this through Svix, and the Svix signature is the authentication.
// It must answer within 15 s, so it only starts checks and never waits for one to run.
const channel3Webhook: Route[2] = async (ctx) => {
  const config = ctx.c.channel3Webhooks;
  if (!config) throw new HttpError(503, "channel3_webhooks_disabled");
  const raw = await readCapped(ctx.req);
  const now = ctx.c.clock.now();
  const signature = verifySvix(config.key, ctx.req.headers, raw, now);
  if (signature === "missing_headers") throw new HttpError(400, "missing_signature_headers");
  // Forgeries are limited per IP, so they never use up the service-wide window real deliveries need.
  if (signature !== "ok") {
    if (!ctx.limits.channel3Forged.hit(clientIp(ctx.req))) throw new HttpError(429, "rate_limited");
    throw new HttpError(401, "invalid_signature");
  }
  if (!ctx.limits.channel3.hit("all")) throw new HttpError(429, "rate_limited");
  const translated = translate(raw);
  const eventId = translated.kind === "event" ? translated.event.id : translated.id;
  if (ctx.recentEvents.has(eventId, now)) return json({ ok: true, duplicate: true });
  if (translated.kind === "ignored") {
    // Type and reason only: the payload stays out of the logs.
    console.log(`channel3 event ${eventId} (${translated.type}) ignored: ${translated.reason}`);
    ctx.recentEvents.remember(eventId, now);
    return json({ ok: true, ignored: true });
  }
  const { event } = translated;
  // A retry after a failed dispatch dispatches again; the mandate lock and one
  // PayPal-Request-Id per capture keep that from ever capturing twice.
  const { wake: ids, notes } = await mandatesToWake(ctx.c, event);
  try {
    await Promise.all(ids.map((id) => ctx.c.dispatcher.dispatch(id, { eventId: event.id })));
  } catch (err) {
    // Only the message: an SDK error can carry request details.
    console.error(`channel3 event ${event.id} dispatch failed:`, (err as Error).message);
    // Nothing recorded, notes included, and not remembered, so Svix's retry dispatches again.
    throw new HttpError(503, "dispatch_failed");
  }
  // The checks are already started; a failed audit write must not make Svix retry and start them
  // again, so it is logged and the delivery still succeeds. Wakes and notes fail independently,
  // so a lost note never costs a wake entry.
  const [woke, noted] = await Promise.allSettled([
    recordWakes(ctx.c, ids, event),
    recordNotes(ctx.c, notes, event),
  ]);
  if (woke.status === "rejected")
    console.error(`channel3 event ${event.id} wake audit failed:`, (woke.reason as Error).message);
  if (noted.status === "rejected")
    console.error(`channel3 event ${event.id} note audit failed:`, (noted.reason as Error).message);
  ctx.recentEvents.remember(event.id, now);
  return json({
    ok: true,
    checks: ids.length,
    notes: noted.status === "fulfilled" ? noted.value.length : 0,
  });
};

export const channel3WebhookRoutes: Route[] = [["POST", "/api/channel3/webhook", channel3Webhook]];
