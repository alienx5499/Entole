import { json } from "../http/http.ts";
import type { Route } from "../http/router.ts";
import { authRoutes } from "./auth.ts";
import { channel3WebhookRoutes } from "./channel3-webhook.ts";
import { mandateRoutes } from "./mandates.ts";
import { opsRoutes } from "./ops.ts";
import { scheduleRoutes } from "./schedule.ts";
import { shippingCallbackRoutes } from "./shipping-callback.ts";
import { studioRoutes } from "./studio.ts";
import { tokenRoutes } from "./tokens.ts";
import { webhookRoutes } from "./webhooks.ts";

export const routes: Route[] = [
  ["GET", "/api/health", async () => json({ ok: true })],
  ...authRoutes,
  ...channel3WebhookRoutes,
  ...mandateRoutes,
  ...opsRoutes,
  ...scheduleRoutes,
  ...shippingCallbackRoutes,
  ...studioRoutes,
  ...tokenRoutes,
  ...webhookRoutes,
];
