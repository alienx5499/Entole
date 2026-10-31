import { checkShipTo } from "@entole/mandate";
import { formatUsd } from "@entole/shared-kernel";
import { HttpError, json, readCapped } from "../http/http.ts";
import type { Route } from "../http/router.ts";
import { requireFreshTransmission } from "./webhooks.ts";

type CallbackBody = {
  id: string;
  country: string;
  region?: string;
  postalCode?: string;
  referenceId: string;
};

const parseCallback = (raw: string): CallbackBody => {
  let b: unknown;
  try {
    b = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "invalid_json");
  }
  const { id, shipping_address: a, purchase_units: units } = (b ?? {}) as Record<string, unknown>;
  const addr = (a ?? {}) as Record<string, unknown>;
  const unit = (Array.isArray(units) ? units[0] : undefined) as Record<string, unknown> | undefined;
  if (typeof id !== "string" || id === "" || typeof addr.country_code !== "string")
    throw new HttpError(400, "invalid_callback");
  const text = (v: unknown) => (typeof v === "string" ? v : undefined);
  const region = text(addr.admin_area_1);
  const postalCode = text(addr.postal_code);
  return {
    id,
    country: addr.country_code,
    ...(region ? { region } : {}),
    ...(postalCode ? { postalCode } : {}),
    // PayPal names an unnamed purchase unit "default".
    referenceId: text(unit?.reference_id) || "default",
  };
};

// PayPal's order update callback, sent while the buyer is on the approval page. No session:
// PayPal's signature authenticates it, and the order must belong to the mandate in the URL and
// still await approval. Every other case gets the same 404, so the route says nothing about
// which orders exist. A refusal is PayPal's 422 shape, which PayPal shows to the buyer.
const shippingCallback: Route[2] = async (ctx) => {
  if (!ctx.limits.shippingCallback.hit("all")) throw new HttpError(429, "rate_limited");
  requireFreshTransmission(ctx);
  const raw = await readCapped(ctx.req);
  if (!(await ctx.c.callbacks.verify(ctx.req.headers, raw)))
    throw new HttpError(401, "invalid_signature");
  const body = parseCallback(raw);
  const result = await checkShipTo(ctx.c, {
    mandateId: ctx.url.searchParams.get("mandate") ?? "",
    orderId: body.id,
    to: {
      country: body.country,
      ...(body.region ? { region: body.region } : {}),
      ...(body.postalCode ? { postalCode: body.postalCode } : {}),
    },
  });
  if (result.outcome === "unknown") throw new HttpError(404, "not_found");
  if (result.outcome === "refused")
    return json({ name: "UNPROCESSABLE_ENTITY", details: [{ issue: result.issue }] }, 422);
  // Accepted: the total stays the signed budget, with one free shipping option selected, since
  // the hold is the cap and the shop's own shipping is inside it.
  const usd = (value: string) => ({ currency_code: "USD", value });
  const total = formatUsd(result.mandate.terms.budget);
  return json({
    id: body.id,
    purchase_units: [
      {
        reference_id: body.referenceId,
        amount: {
          ...usd(total),
          breakdown: { item_total: usd(total), shipping: usd("0.00") },
        },
        shipping_options: [
          {
            id: "included",
            label: "Shipping within your limit",
            type: "SHIPPING",
            selected: true,
            amount: usd("0.00"),
          },
        ],
      },
    ],
  });
};

export const shippingCallbackRoutes: Route[] = [
  ["POST", "/api/paypal/shipping-callback", shippingCallback],
];
