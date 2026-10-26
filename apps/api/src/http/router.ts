import type { Container } from "../composition-root.ts";
import type { LimitWatch } from "../jobs/limit-watch.ts";
import { routes } from "../routes/index.ts";
import { errorResponse, HttpError } from "./http.ts";
import { clientIp, RateLimiter } from "./rate-limit.ts";

export type RouteContext = {
  req: Request;
  url: URL;
  params: Record<string, string>;
  c: Container;
  watch: LimitWatch;
  limits: {
    mandates: RateLimiter;
    checkNow: RateLimiter;
    studio: RateLimiter[];
    webhookIp: RateLimiter;
    webhookAll: RateLimiter;
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
    // One dashboard question can take several model turns when agents hand work to each other.
    studio: [new RateLimiter(30, 60_000), new RateLimiter(300, 86_400_000)],
    // PayPal sends a few deliveries a minute at most. The total cap holds even when the per-IP key
    // is spoofed, and protects the PayPal quota that real orders need.
    webhookIp: new RateLimiter(30, 60_000),
    webhookAll: new RateLimiter(300, 60_000),
    // Sign-in and the PayPal return each call PayPal, so they are capped per IP and in total.
    signIn: new RateLimiter(20, 60_000),
    signInAll: new RateLimiter(600, 60_000),
    // Refund and close move money at PayPal; a person needs a handful, never dozens.
    money: new RateLimiter(20, 60_000),
    tokens: new RateLimiter(10, 60_000),
  };
  // Every other request: a per-IP ceiling that stops floods before any handler runs. Health checks
  // and PayPal webhooks are left out; webhooks have their own windows.
  const perIp = new RateLimiter(240, 60_000);
  const unthrottled = new Set(["/api/health", "/api/paypal/webhook"]);
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    try {
      if (!unthrottled.has(path) && !perIp.hit(clientIp(req)))
        throw new HttpError(429, "rate_limited");
      let pathMatched = false;
      for (const [method, pattern, handler] of routes) {
        const params = match(pattern, path);
        if (!params) continue;
        pathMatched = true;
        if (method === req.method) return await handler({ req, url, params, c, watch, limits });
      }
      throw pathMatched
        ? new HttpError(405, "method_not_allowed")
        : new HttpError(404, "not_found");
    } catch (err) {
      return errorResponse(err);
    }
  };
};
