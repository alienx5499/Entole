import { afterFunding } from "@entole/limit-order";
import { handlePayPalEvent, type PayPalEvent } from "@entole/mandate";
import { HttpError, json, readCapped } from "../http/http.ts";
import { clientIp } from "../http/rate-limit.ts";
import type { Route, RouteContext } from "../http/router.ts";

// PayPal stamps each delivery; an older or future one is refused before its signature is checked.
const MAX_SKEW_MS = 15 * 60_000;

export const requireFreshTransmission = (ctx: RouteContext): void => {
  const sentAt = Date.parse(ctx.req.headers.get("paypal-transmission-time") ?? "");
  if (!(Math.abs(ctx.c.clock.now().getTime() - sentAt) <= MAX_SKEW_MS))
    throw new HttpError(400, "stale_transmission");
};

const parseEvent = (raw: string): PayPalEvent => {
  let e: unknown;
  try {
    e = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "invalid_json");
  }
  const { id, event_type } = (e ?? {}) as Record<string, unknown>;
  if (typeof id !== "string" || id === "" || typeof event_type !== "string")
    throw new HttpError(400, "invalid_event");
  return e as PayPalEvent;
};

// No session: PayPal calls this, and PayPal's signature is the authentication.
// The body is read once as text, since verification needs the exact bytes PayPal sent.
const paypalWebhook: Route[2] = async (ctx) => {
  if (!ctx.c.webhooks) throw new HttpError(503, "webhooks_disabled");
  if (!ctx.limits.webhookIp.hit(clientIp(ctx.req)) || !ctx.limits.webhookAll.hit("all"))
    throw new HttpError(429, "rate_limited");
  requireFreshTransmission(ctx);
  const raw = await readCapped(ctx.req);
  const event = parseEvent(raw);
  if (!(await ctx.c.webhooks.verify(ctx.req.headers, raw)))
    throw new HttpError(400, "invalid_signature");
  const result = await handlePayPalEvent(ctx.c, event);
  if (result.outcome === "funded")
    await afterFunding({ ...ctx.c, watch: ctx.watch }, result.mandate);
  return json({ ok: true });
};

export const webhookRoutes: Route[] = [["POST", "/api/paypal/webhook", paypalWebhook]];
