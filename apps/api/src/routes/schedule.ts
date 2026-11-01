import { decideCheck, proposeRequestedCheck } from "@entole/limit-order";
import type { Mandate } from "@entole/mandate";
import { HttpError, json } from "../http/http.ts";
import { idempotent } from "../http/idempotency.ts";
import type { Route, RouteContext } from "../http/router.ts";
import { readJson } from "../http/validation.ts";
import { mandateView } from "../http/views.ts";
import { ownedMandate, requireCaller, requireUserId } from "./auth.ts";

const owned = async (ctx: RouteContext, auth: (ctx: RouteContext) => Promise<string>) => {
  const m = await ownedMandate(ctx, undefined, auth);
  if (!ctx.limits.checkNow.hit(m.id)) throw new HttpError(429, "rate_limited");
  if (m.status !== "funded" || m.terms.kind !== "limit") throw new HttpError(409, "not_watching");
  return m;
};

const parseAt = (v: unknown): Date => {
  const at = typeof v === "string" ? new Date(v) : new Date(Number.NaN);
  if (Number.isNaN(at.getTime())) throw new HttpError(400, "invalid_field", { field: "at" });
  return at;
};

const view = async (ctx: RouteContext, m: Mandate) =>
  json(mandateView(m, await ctx.c.repo.listAudit(m.id), null, ctx.c.clock.now()));

// The agent proposes one extra price check. An AI client's token may call this; with no `at`
// the watcher picks the time itself. The proposal moves nothing until the buyer accepts it.
const propose: Route[2] = async (ctx) => {
  const m = await owned(ctx, requireCaller);
  if (!ctx.limits.proposals.hit(m.ownerId)) throw new HttpError(429, "rate_limited");
  const b = ((await readJson(ctx.req)) ?? {}) as { at?: unknown; reason?: unknown };
  const by = ctx.req.headers.get("authorization") ? "ai_client" : "watcher";
  const at = b.at === undefined ? undefined : parseAt(b.at);
  const reason = typeof b.reason === "string" ? b.reason : undefined;
  const result = await proposeRequestedCheck({ ...ctx.c, histories: ctx.watch }, m.id, {
    at,
    reason,
    by,
  });
  if (result === "not_watching") throw new HttpError(409, result);
  if (result !== "proposed") throw new HttpError(422, result);
  return view(ctx, m);
};

// Only the buyer, in a browser session, answers. Accepting may carry a time the buyer dragged
// the proposal to; decideCheck checks it against the same signed limit before the check is armed.
const decide: Route[2] = async (ctx) => {
  const m = await owned(ctx, requireUserId);
  const b = ((await readJson(ctx.req)) ?? {}) as { accept?: unknown; at?: unknown };
  if (typeof b.accept !== "boolean") throw new HttpError(400, "invalid_field", { field: "accept" });
  const at = b.accept && b.at !== undefined ? parseAt(b.at) : undefined;
  const result = await decideCheck(ctx.c, m.id, { accept: b.accept, at });
  if (result.outcome === "accepted") ctx.watch.scheduleCheck(m.id, result.at);
  else if (result.outcome === "no_pending_proposal" || result.outcome === "not_watching")
    throw new HttpError(409, result.outcome);
  else if (result.outcome !== "rejected") throw new HttpError(422, result.outcome);
  return view(ctx, m);
};

export const scheduleRoutes: Route[] = [
  ["POST", "/api/mandates/:id/schedule/propose", idempotent(propose)],
  ["POST", "/api/mandates/:id/schedule/decide", decide],
];
