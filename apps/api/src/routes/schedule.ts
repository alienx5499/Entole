import { hhmm, proposeCheck, scheduleSteps } from "@entole/limit-order";
import { checkTimeRefusal, latestCheckAt, type Mandate } from "@entole/mandate";
import { formatUsd, usd } from "@entole/shared-kernel";
import { HttpError, json } from "../http/http.ts";
import { idempotent } from "../http/idempotency.ts";
import type { Route, RouteContext } from "../http/router.ts";
import { readJson } from "../http/validation.ts";
import { mandateView } from "../http/views.ts";
import { requireCaller, requireUserId } from "./auth.ts";

const MIN = 60_000;
const MAX_REASON = 200;

// The buyer's answers; proposals are recorded by proposeCheck (packages/limit-order).
type ScheduleStep = "accepted" | "rejected";

const owned = async (ctx: RouteContext, auth: (ctx: RouteContext) => Promise<string>) => {
  const userId = await auth(ctx);
  const m = await ctx.c.repo.get(ctx.params.id ?? "");
  if (!m) throw new HttpError(404, "not_found");
  if (m.ownerId !== userId) throw new HttpError(403, "forbidden");
  if (!ctx.limits.checkNow.hit(m.id)) throw new HttpError(429, "rate_limited");
  if (m.status !== "funded" || m.terms.kind !== "limit") throw new HttpError(409, "not_watching");
  return m;
};

const parseAt = (v: unknown): Date => {
  const at = typeof v === "string" ? new Date(v) : new Date(Number.NaN);
  if (Number.isNaN(at.getTime())) throw new HttpError(400, "invalid_field", { field: "at" });
  return at;
};

// The signed limit (latestCheckAt): after now and no later than the window's end or the PayPal
// hold's expiry, whichever comes first.
const checkTime = (v: unknown, m: Mandate, now: number): Date => {
  const at = parseAt(v);
  const refused = checkTimeRefusal(m, at, new Date(now));
  if (refused) throw new HttpError(422, refused);
  return at;
};

const record = (ctx: RouteContext, m: Mandate, step: ScheduleStep, message: string, data = {}) =>
  ctx.c.repo.appendAudit(m.id, {
    at: ctx.c.clock.now(),
    kind: "agent_step",
    message,
    data: { schedule: step, ...data },
  });

const view = async (ctx: RouteContext, m: Mandate) =>
  json(mandateView(m, await ctx.c.repo.listAudit(m.id), null, ctx.c.clock.now()));

// The watcher's own suggestion: the closer the cheapest known price is to the limit, the sooner
// the extra check. A fixed three-step rule; a model could weigh trend and shop count.
const suggest = async (ctx: RouteContext, m: Mandate, now: number) => {
  const histories = await ctx.watch.history(m);
  const prices = m.terms.candidates.map(
    (c) => histories.get(c.productId)?.at(-1)?.price.cents ?? c.baselinePrice.cents,
  );
  const best = Math.min(...prices);
  const limit = m.terms.maxUnitPrice.cents;
  const gap = ((best - limit) / limit) * 100;
  const minutes = gap <= 0 ? 5 : gap <= 10 ? 15 : 45;
  const reason =
    gap <= 0
      ? `Best known price $${formatUsd(usd(best))} is at or under your limit`
      : `Best known price $${formatUsd(usd(best))} is ${gap.toFixed(1)}% above your limit`;
  return { at: new Date(Math.min(now + minutes * MIN, latestCheckAt(m).getTime() - MIN)), reason };
};

// The agent proposes one extra price check. An AI client's token may call this; with no `at`
// the watcher picks the time itself. The proposal moves nothing until the buyer accepts it.
const propose: Route[2] = async (ctx) => {
  const m = await owned(ctx, requireCaller);
  if (!ctx.limits.proposals.hit(m.ownerId)) throw new HttpError(429, "rate_limited");
  const now = ctx.c.clock.now().getTime();
  const b = ((await readJson(ctx.req)) ?? {}) as { at?: unknown; reason?: unknown };
  const by = ctx.req.headers.get("authorization") ? "ai_client" : "watcher";
  const picked = b.at === undefined ? await suggest(ctx, m, now) : null;
  const at = picked?.at ?? parseAt(b.at);
  const reason =
    picked?.reason ??
    (typeof b.reason === "string" && b.reason.trim() !== ""
      ? b.reason.trim().slice(0, MAX_REASON)
      : "Extra check requested");
  const result = await proposeCheck(ctx.c, m, { at, reason, by });
  if (result !== "proposed") throw new HttpError(422, result);
  return view(ctx, m);
};

// Only the buyer, in a browser session, answers. Accepting may carry a time the buyer dragged
// the proposal to; it is checked against the same signed limit before the check is armed.
const decide: Route[2] = async (ctx) => {
  const m = await owned(ctx, requireUserId);
  const now = ctx.c.clock.now().getTime();
  const pending = scheduleSteps(await ctx.c.repo.listAudit(m.id)).at(-1);
  if (pending?.data?.schedule !== "proposed") throw new HttpError(409, "no_pending_proposal");
  const b = ((await readJson(ctx.req)) ?? {}) as { accept?: unknown; at?: unknown };
  if (typeof b.accept !== "boolean") throw new HttpError(400, "invalid_field", { field: "accept" });
  if (!b.accept) {
    await record(ctx, m, "rejected", "Buyer rejected the proposed check");
    return view(ctx, m);
  }
  const at = checkTime(b.at ?? pending.data.at, m, now);
  ctx.watch.scheduleCheck(m.id, at);
  await record(ctx, m, "accepted", `Buyer accepted an extra check at ${hhmm(at)}`, {
    at: at.toISOString(),
  });
  return view(ctx, m);
};

export const scheduleRoutes: Route[] = [
  ["POST", "/api/mandates/:id/schedule/propose", idempotent(propose)],
  ["POST", "/api/mandates/:id/schedule/decide", decide],
];
