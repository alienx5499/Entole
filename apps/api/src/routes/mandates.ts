import {
  afterFunding,
  createLimitOrder,
  priceStats,
  recordReplayStarted,
  replayIndex,
} from "@entole/limit-order";
import {
  closeMandate,
  fundMandate,
  type Mandate,
  NotRefundable,
  type ProductSearch,
  proposeOrder,
  refundMandate,
  toAp2,
} from "@entole/mandate";
import { formatUsd } from "@entole/shared-kernel";
import { withDemoInjection } from "@entole/shopping";
import { HttpError, json, redirect } from "../http/http.ts";
import { idempotent } from "../http/idempotency.ts";
import { clientIp } from "../http/rate-limit.ts";
import type { Route, RouteContext } from "../http/router.ts";
import { parseCreateMandate, readJson } from "../http/validation.ts";
import {
  candidateView,
  mandateSummaryView,
  mandateView,
  priceStatsView,
  verdictView,
} from "../http/views.ts";
import { REPLAY_MS_PER_POINT } from "../jobs/limit-watch.ts";
import { currentUserId, ownedMandate, requireCaller } from "./auth.ts";

const NO_CATALOG: ProductSearch = { search: async () => [], resolveOffer: async () => null };

// Callers have already checked ownership, so the PayPal approve link may go in the view.
const ownerView = async (ctx: RouteContext, m: Mandate) =>
  mandateView(
    m,
    await ctx.c.repo.listAudit(m.id),
    m.status === "awaiting_approval" ? await ctx.c.repo.approveUrlFor(m.id) : null,
    ctx.c.clock.now(),
  );

const viewOf = async (ctx: RouteContext, id: string) => {
  const m = await ctx.c.repo.get(id);
  if (!m) throw new HttpError(404, "not_found");
  return ownerView(ctx, m);
};

// `?full=1` returns every order as its full view in one pass: one audit read for all of them.
const list: Route[2] = async (ctx) => {
  const userId = await requireCaller(ctx);
  const mandates = await ctx.c.repo.listByOwner(userId);
  const now = ctx.c.clock.now();
  if (ctx.url.searchParams.get("full") !== "1")
    return json(mandates.map((m) => mandateSummaryView(m, now)));
  const audits = await ctx.c.repo.listAuditFor(mandates.map((m) => m.id));
  return json(
    await Promise.all(
      mandates.map(async (m) =>
        mandateView(
          m,
          audits.get(m.id) ?? [],
          m.status === "awaiting_approval" ? await ctx.c.repo.approveUrlFor(m.id) : null,
          now,
        ),
      ),
    ),
  );
};

const create: Route[2] = async (ctx) => {
  const userId = await requireCaller(ctx);
  if (!ctx.limits.mandates.hit(userId)) throw new HttpError(429, "rate_limited");
  const r = parseCreateMandate(await readJson(ctx.req));
  const result = await createLimitOrder(ctx.c, { ownerId: userId, ...r });
  if (result.outcome === "no_candidates")
    throw new HttpError(422, "no_candidates", { rejected: result.rejected });
  if (result.outcome !== "created") throw new HttpError(429, result.outcome);
  return json({
    id: result.id,
    approveUrl: result.approveUrl,
    candidates: result.candidates.map(candidateView),
    rejected: result.rejected,
  });
};

// The order as Agent Payments Protocol mandates, downloadable from the receipt. A bearer token may
// read it too, so an assistant can hand the mandates to another agent.
const ap2: Route[2] = async (ctx) => {
  const m = await ownedMandate(ctx, undefined, requireCaller);
  return json(
    toAp2(m, await ctx.c.repo.listAudit(m.id)),
    200,
    new Headers({ "Content-Disposition": `attachment; filename="entole-${m.id}-ap2.json"` }),
  );
};

const get: Route[2] = async (ctx) => {
  return json(await ownerView(ctx, await ownedMandate(ctx, undefined, requireCaller)));
};

// PayPal sends the browser here after approval; the order token is the PayPal order id.
const paypalReturn: Route[2] = async (ctx) => {
  if (!ctx.limits.signIn.hit(clientIp(ctx.req)) || !ctx.limits.signInAll.hit("all"))
    throw new HttpError(429, "rate_limited");
  const id = ctx.url.searchParams.get("mandate") ?? "";
  const token = ctx.url.searchParams.get("token") ?? "";
  if (id === "" || token === "") throw new HttpError(400, "invalid_return");
  const page = `/mandates/${encodeURIComponent(id)}`;
  // No session (expired or another browser): log in first, then come straight back here to fund.
  // Nothing is authorized before that, so the approved order is not stranded.
  if (!(await currentUserId(ctx)))
    return redirect(
      `/api/auth/paypal/start?next=${encodeURIComponent(`${ctx.url.pathname}${ctx.url.search}`)}`,
    );
  try {
    const m = await ownedMandate(ctx, id);
    // A refresh of the return URL after funding is not a failure.
    if (m.status === "funded" || m.status === "exhausted") return redirect(page);
    const funded = await fundMandate(ctx.c, { mandateId: id, orderId: token });
    await afterFunding({ ...ctx.c, watch: ctx.watch }, funded);
    return redirect(page);
  } catch (err) {
    console.error(err);
    return redirect(`${page}?error=funding`);
  }
};

const checkNow: Route[2] = async (ctx) => {
  const m = await ownedMandate(ctx);
  if (!ctx.limits.checkNow.hit(m.id)) throw new HttpError(429, "rate_limited");
  const result = await ctx.watch.check(m.id);
  return json({ ...result, mandate: await viewOf(ctx, m.id) });
};

const replayStart: Route[2] = async (ctx) => {
  const m = await ownedMandate(ctx);
  if (!m.replay) throw new HttpError(409, "not_replay");
  if (m.status !== "funded") throw new HttpError(409, "not_funded");
  // Each start refetches the candidates' price histories from Channel3.
  if (!ctx.limits.checkNow.hit(m.id)) throw new HttpError(429, "rate_limited");
  const started = await ctx.watch.startReplay(m);
  if (!started) throw new HttpError(422, "no_price_history");
  ctx.watch.track(m.id);
  await recordReplayStarted(ctx.c, m.id, started.points);
  return json({
    startedAt: started.startedAt.toISOString(),
    msPerPoint: REPLAY_MS_PER_POINT,
    points: started.points,
  });
};

const prices: Route[2] = async (ctx) => {
  const m = await ownedMandate(ctx);
  const histories = await ctx.watch.history(m);
  const startedAt = ctx.watch.replayStartedAt(m.id);
  const elapsed = startedAt ? Math.max(0, ctx.c.clock.now().getTime() - startedAt.getTime()) : 0;
  return json({
    replay: m.replay,
    startedAt: startedAt?.toISOString() ?? null,
    msPerPoint: REPLAY_MS_PER_POINT,
    candidates: m.terms.candidates.map((c) => {
      const points = histories.get(c.productId) ?? [];
      const currentIndex =
        startedAt && points.length > 0
          ? replayIndex(elapsed, REPLAY_MS_PER_POINT, points.length)
          : null;
      const current = currentIndex === null ? undefined : points[currentIndex];
      return {
        productId: c.productId,
        title: c.title,
        limit: formatUsd(m.terms.maxUnitPrice),
        points: points.map((p) => ({ at: p.at.toISOString(), price: formatUsd(p.price) })),
        currentIndex,
        current: current ? formatUsd(current.price) : null,
        stats: priceStatsView(priceStats(points)),
      };
    }),
  });
};

// Labelled simulation: a compromised agent proposes the planted listing through the real use case.
const simulate: Route[2] = async (ctx) => {
  const m = await ownedMandate(ctx);
  if (!m.demoInjection) throw new HttpError(409, "not_demo");
  if (!ctx.limits.checkNow.hit(m.id)) throw new HttpError(429, "rate_limited");
  // One injected source, so the proposal resolves the same title the trap search produced.
  const prices = ctx.watch.priceSourceFor(m.id);
  const injected = withDemoInjection({
    ...NO_CATALOG,
    resolveOffer: (i) => prices.resolveOffer(i),
  });
  const [trap] = await injected.search({ query: m.terms.item.query, limit: 1 });
  const merchant = trap?.offers[0]?.merchant;
  if (!trap || !merchant) throw new Error("Demo injection listing is missing");
  const options = Object.fromEntries(
    Object.entries(trap.options).flatMap(([k, vs]) => (vs[0] === undefined ? [] : [[k, vs[0]]])),
  );
  const { verdict } = await proposeOrder(
    { ...ctx.c, search: injected },
    { mandateId: m.id, productId: trap.productId, merchant, options, source: "simulated" },
  );
  return json({ verdict: verdictView(verdict) });
};

const close: Route[2] = async (ctx) => {
  const m = await ownedMandate(ctx, undefined, requireCaller);
  if (!ctx.limits.money.hit(m.ownerId)) throw new HttpError(429, "rate_limited");
  const closed = await closeMandate(ctx.c, m.id);
  ctx.watch.untrack(m.id);
  return json(await ownerView(ctx, closed));
};

const refund: Route[2] = async (ctx) => {
  const m = await ownedMandate(ctx);
  if (!ctx.limits.money.hit(m.ownerId)) throw new HttpError(429, "rate_limited");
  try {
    return json(await ownerView(ctx, await refundMandate(ctx.c, m.id)));
  } catch (err) {
    if (err instanceof NotRefundable) throw new HttpError(409, "not_refundable");
    throw err;
  }
};

export const mandateRoutes: Route[] = [
  ["GET", "/api/mandates", list],
  ["POST", "/api/mandates", idempotent(create)],
  ["GET", "/api/mandates/:id", get],
  ["GET", "/api/mandates/:id/ap2", ap2],
  ["GET", "/api/paypal/return", paypalReturn],
  ["POST", "/api/mandates/:id/check-now", checkNow],
  ["POST", "/api/mandates/:id/replay/start", replayStart],
  ["GET", "/api/mandates/:id/prices", prices],
  ["POST", "/api/mandates/:id/simulate", simulate],
  ["POST", "/api/mandates/:id/close", idempotent(close)],
  ["POST", "/api/mandates/:id/refund", refund],
];
