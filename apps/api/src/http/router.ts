import type { Container } from "../composition-root.ts";
import type { LimitWatch } from "../jobs/limit-watch.ts";
import { routes } from "../routes/index.ts";
import { errorResponse, HttpError } from "./http.ts";
import { clientIp, RateLimiter } from "./rate-limit.ts";
import { RecentIds } from "./recent-ids.ts";

export type RouteContext = {
  req: Request;
  url: URL;
  params: Record<string, string>;
  c: Container;
  watch: LimitWatch;
  recentEvents: RecentIds; // Channel3 event ids already dispatched
  limits: {
    mandates: RateLimiter;
    checkNow: RateLimiter;
    proposals: RateLimiter;
    studio: RateLimiter[];
    webhookIp: RateLimiter;
    webhookAll: RateLimiter;
    channel3: RateLimiter;
    channel3Forged: RateLimiter;
    shippingCallback: RateLimiter;
    signIn: RateLimiter;
    signInAll: RateLimiter;
    money: RateLimiter;
    tokens: RateLimiter;
  };
};

export type Route = [
  method: string,
  pattern: string,
  handler: (ctx: RouteContext) => Promise<Response>,
];

const match = (pattern: string, path: string): Record<string, string> | null => {
  const want = pattern.split("/");
  const got = path.split("/");
  if (want.length !== got.length) return null;
  const params: Record<string, string> = {};
  for (const [i, w] of want.entries()) {
    const g = got[i] ?? "";
    if (w.startsWith(":")) {
      if (g === "") return null;
      try {
        params[w.slice(1)] = decodeURIComponent(g);
      } catch {
        return null;
      }
    } else if (w !== g) return null;
  }
  return params;
};

// A small hand-written router: first matching method and path wins, every error goes through
// errorResponse so no stack trace or secret reaches the client.
export const createRouter = (c: Container, watch: LimitWatch) => {
  const limits = {
    mandates: new RateLimiter(10, 60_000),
    checkNow: new RateLimiter(60, 60_000),
    // Each proposal writes an audit row and may read price history; an AI client's token can call
    // it, so cap it per owner across all their mandates.
    proposals: new RateLimiter(10, 60_000),
    // One dashboard question can take several model turns when agents hand work to each other.
    studio: [new RateLimiter(30, 60_000), new RateLimiter(300, 86_400_000)],
    // PayPal sends a few deliveries a minute at most. The total cap holds even when the per-IP key
    // is spoofed, and protects the PayPal quota that real orders need.
    webhookIp: new RateLimiter(30, 60_000),
    webhookAll: new RateLimiter(300, 60_000),
    // Channel3 sends one delivery per offer change across every subscribed product, from Svix's
    // shared addresses, so the cap is service-wide. The route counts only verified deliveries;
    // bad signatures go through channel3Forged, per IP, so they never use up PayPal's webhookIp.
    channel3: new RateLimiter(600, 60_000),
    channel3Forged: new RateLimiter(30, 60_000),
    // PayPal asks on every approval page load and address change, from a few shared PayPal
    // addresses, so the cap is service-wide. Each answer is a local signature check and one read.
    shippingCallback: new RateLimiter(600, 60_000),
    // Sign-in and the PayPal return each call PayPal, so they are capped per IP and in total.
    signIn: new RateLimiter(20, 60_000),
    signInAll: new RateLimiter(600, 60_000),
    // Refund and close move money at PayPal; a person needs a handful, never dozens.
    money: new RateLimiter(20, 60_000),
    tokens: new RateLimiter(10, 60_000),
  };
  // Every other request: a per-IP ceiling that stops floods before any handler runs. Health checks
  // and PayPal's own calls are left out: webhooks and the shipping callback come from a few PayPal
  // addresses shared by every buyer, and have their own windows.
  const perIp = new RateLimiter(240, 60_000);
  const recentEvents = new RecentIds();
  const unthrottled = new Set([
    "/api/health",
    "/api/paypal/webhook",
    "/api/channel3/webhook",
    "/api/paypal/shipping-callback",
  ]);
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    try {
      if (!unthrottled.has(path) && !perIp.hit(clientIp(req)))
        throw new HttpError(429, "rate_limited");
      let pathMatched = false;
      // HEAD runs the GET handler and drops the body, so uptime monitors can probe any GET route.
      const head = req.method === "HEAD";
      for (const [method, pattern, handler] of routes) {
        const params = match(pattern, path);
        if (!params) continue;
        pathMatched = true;
        if (method !== (head ? "GET" : req.method)) continue;
        const res = await handler({ req, url, params, c, watch, recentEvents, limits });
        return head ? new Response(null, res) : res;
      }
      throw pathMatched
        ? new HttpError(405, "method_not_allowed")
        : new HttpError(404, "not_found");
    } catch (err) {
      return errorResponse(err);
    }
  };
};
