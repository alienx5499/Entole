import { json } from "../http/http.ts";
import type { Route } from "../http/router.ts";
import { authRoutes } from "./auth.ts";
import { mandateRoutes } from "./mandates.ts";
import { studioRoutes } from "./studio.ts";
import { tokenRoutes } from "./tokens.ts";
import { webhookRoutes } from "./webhooks.ts";

export const routes: Route[] = [
  ["GET", "/api/health", async () => json({ ok: true })],
  ...authRoutes,
  ...mandateRoutes,
  ...studioRoutes,
  ...tokenRoutes,
  ...webhookRoutes,
];
