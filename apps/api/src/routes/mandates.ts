import { replayIndex, startLimitTracking } from "@entole/limit-order";
import {
  closeMandate,
  createMandate,
  fundMandate,
  type Mandate,
  type MandateTerms,
  NotRefundable,
  type ProductSearch,
  proposeOrder,
  refundMandate,
} from "@entole/mandate";
import { formatUsd } from "@entole/shared-kernel";
import { rememberTaste, shortlistCandidates, withDemoInjection } from "@entole/shopping";
import { HttpError, json, redirect } from "../http/http.ts";
import { clientIp } from "../http/rate-limit.ts";
import type { Route, RouteContext } from "../http/router.ts";
import { parseCreateMandate, readJson } from "../http/validation.ts";
import { candidateView, mandateSummaryView, mandateView, verdictView } from "../http/views.ts";
import { REPLAY_MS_PER_POINT } from "../jobs/limit-watch.ts";
import { currentUserId, requireCaller, requireUserId } from "./auth.ts";

const DAY_MS = 24 * 3600 * 1000;
const NO_CATALOG: ProductSearch = { search: async () => [], resolveOffer: async () => null };

// `auth` is requireCaller only on the routes an AI client's bearer token may reach.
const ownedMandate = async (
  ctx: RouteContext,
  id = ctx.params.id ?? "",
  auth = requireUserId,
): Promise<Mandate> => {
  const userId = await auth(ctx);
  const m = await ctx.c.repo.get(id);
  if (!m) throw new HttpError(404, "not_found");
  if (m.ownerId !== userId) throw new HttpError(403, "forbidden");
  return m;
};

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

const list: Route[2] = async (ctx) => {
  const userId = await requireCaller(ctx);
  return json(
    (await ctx.c.repo.listByOwner(userId)).map((m) => mandateSummaryView(m, ctx.c.clock.now())),
  );
};

const create: Route[2] = async (ctx) => {
  const userId = await requireCaller(ctx);
  if (!ctx.limits.mandates.hit(userId)) throw new HttpError(429, "rate_limited");
  // Each create spends Groq, Channel3 and PayPal calls, so cap the day per user and overall.
  const since = new Date(ctx.c.clock.now().getTime() - DAY_MS);
  const caps = ctx.c.createCaps;
  if ((await ctx.c.repo.countCreatedSince(since, userId)) >= caps.perUser)
    throw new HttpError(429, "daily_limit_reached");
  if ((await ctx.c.repo.countCreatedSince(since)) >= caps.total)
    throw new HttpError(429, "service_daily_limit_reached");
  const r = parseCreateMandate(await readJson(ctx.req));
  const terms: Omit<MandateTerms, "candidates"> = {
    kind: "limit",
    item: {
      query: r.query,
      requiredAttributes: r.requiredAttributes,
      brands: r.brands,
      avoid: r.avoid,
    },
    maxUnitPrice: r.limit,
    budget: r.limit,
    allowedMerchants: [], // empty means any merchant; the signed candidates pin the items
    validUntil: new Date(ctx.c.clock.now().getTime() + r.validDays * DAY_MS),
  };
  const shortlist = await shortlistCandidates(ctx.c, {
    terms,
    demoInjection: r.demoInjection,
    max: 3,
  });
  if (shortlist.kept.length === 0)
    throw new HttpError(422, "no_candidates", { rejected: shortlist.rejected });
  const { mandate, approveUrl } = await createMandate(ctx.c, {
    ownerId: userId,
    terms: { ...terms, candidates: shortlist.kept },
    demoInjection: r.demoInjection,
    replay: r.replay,
    rejected: shortlist.rejected,
    baseUrl: ctx.c.publicBaseUrl,
  });
  return json({
    id: mandate.id,
    approveUrl,
    candidates: shortlist.kept.map(candidateView),
    rejected: shortlist.rejected,
  });
};

const get: Route[2] = async (ctx) => {
  return json(await ownerView(ctx, await ownedMandate(ctx, undefined, requireCaller)));
};

// Taste and tracking run after the money side: neither binds money, and a hiccup in either
// must not turn a funded mandate into an error. Shared by the browser return and the webhook.
export const afterFunding = async (ctx: RouteContext, funded: Mandate): Promise<void> => {
  await rememberTaste(ctx.c, funded).catch((err: unknown) => console.error(err));
  if (funded.terms.kind === "limit") {
    // Not awaited: a slow Channel3 must not delay the response. Failures are audited inside.
    void startLimitTracking(ctx.c, funded).catch((err: unknown) => console.error(err));
    ctx.watch.track(funded.id);
  }
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
    await afterFunding(ctx, await fundMandate(ctx.c, { mandateId: id, orderId: token }));
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
  await ctx.c.repo.appendAudit(m.id, {
    at: ctx.c.clock.now(),
    kind: "agent_step",
    message: `Price replay started: ${started.points} recorded daily prices`,
    data: { replay: "started" },
  });
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
      };
    }),
  });
};

// Labelled simulation: a compromised agent proposes the planted listing through the real use case.
const simulate: Route[2] = async (ctx) => {
  const m = await ownedMandate(ctx);
  if (!m.demoInjection) throw new HttpError(409, "not_demo");
  if (!ctx.limits.checkNow.hit(m.id)) throw new HttpError(429, "rate_limited");
  const [trap] = await withDemoInjection(NO_CATALOG).search({ query: "", limit: 1 });
  const merchant = trap?.offers[0]?.merchant;
  if (!trap || !merchant) throw new Error("Demo injection listing is missing");
  const options = Object.fromEntries(
    Object.entries(trap.options).flatMap(([k, vs]) => (vs[0] === undefined ? [] : [[k, vs[0]]])),
  );
  const { verdict } = await proposeOrder(
    { ...ctx.c, search: withDemoInjection(ctx.watch.priceSourceFor(m.id)) },
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
  ["POST", "/api/mandates", create],
  ["GET", "/api/mandates/:id", get],
  ["GET", "/api/paypal/return", paypalReturn],
  ["POST", "/api/mandates/:id/check-now", checkNow],
  ["POST", "/api/mandates/:id/replay/start", replayStart],
  ["GET", "/api/mandates/:id/prices", prices],
  ["POST", "/api/mandates/:id/simulate", simulate],
  ["POST", "/api/mandates/:id/close", close],
  ["POST", "/api/mandates/:id/refund", refund],
];
