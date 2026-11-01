import { HttpError, json } from "../http/http.ts";
import { clientIp } from "../http/rate-limit.ts";
import type { Route } from "../http/router.ts";
import { sameSecret } from "./auth.ts";

// Which Groq keys work right now, by slot, for the owner. Hidden (404) unless OPS_TOKEN is set; the
// per-IP and service-wide windows come before the token check so guessing it is slow.
export const opsRoutes: Route[] = [
  [
    "GET",
    "/api/ops/groq",
    async ({ req, c, limits }) => {
      if (!c.opsToken) throw new HttpError(404, "not_found");
      if (!limits.ops.hit(clientIp(req)) || !limits.opsAll.hit("all"))
        throw new HttpError(429, "rate_limited");
      const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "");
      if (!m?.[1] || !sameSecret(m[1], c.opsToken)) throw new HttpError(401, "unauthorized");
      return json({ keys: await c.groqHealth.check() });
    },
  ],
];
