import { formatUsd, parseUsd } from "@entole/shared-kernel";
import {
  ApiError,
  CallbackEvents,
  type CapturedPayment,
  CheckoutPaymentIntent,
  Client,
  Environment,
  ItemCategory,
  type OAuthToken,
  OrdersController,
  PaymentsController,
  PaypalExperienceUserAction,
  PaypalWalletContextShippingPreference,
} from "@paypal/paypal-server-sdk";
import type { PaymentGateway } from "../../application/ports.ts";

// A hung upstream call must not hold a mandate lock or a request forever.
const TIMEOUT_MS = 15_000;

// The SDK selects its host by environment and takes no base URL, so PAYPAL_API_BASE maps onto one.
const ENVIRONMENTS: Record<string, Environment> = {
  "https://api-m.sandbox.paypal.com": Environment.Sandbox,
  "https://api-m.paypal.com": Environment.Production,
};

// 422 issues on a capture that mean the buyer's funding was refused, not that the request was wrong.
const DECLINES = new Set(["INSTRUMENT_DECLINED", "TRANSACTION_REFUSED", "PAYER_CANNOT_PAY"]);

export class PayPalError extends Error {
  constructor(
    readonly status: number,
    readonly debugId: string | undefined,
    readonly issues: string[] = [],
  ) {
    super(`PayPal request failed: status ${status}, debug_id ${debugId ?? "none"}`);
    this.name = "PayPalError";
  }
}

type Config = { clientId: string; clientSecret: string; baseUrl: string; fetch?: typeof fetch };

const REFRESH_MARGIN_S = 60;

// Orders, authorizations, captures, voids and refunds go through the PayPal Server SDK. Webhook
// signatures are checked locally (paypal-signature.ts), so no raw HTTP call is left here.
export class PayPalGateway implements PaymentGateway {
  private readonly client: Client;
  private readonly orders: OrdersController;
  private readonly payments: PaymentsController;
  private token?: Promise<OAuthToken>;

  constructor(cfg: Config) {
    const environment = ENVIRONMENTS[cfg.baseUrl.replace(/\/+$/, "")];
    if (!environment) throw new Error(`Unsupported PayPal API base: ${cfg.baseUrl}`);
    this.client = new Client({
      environment,
      timeout: TIMEOUT_MS,
      clientCredentialsAuthCredentials: {
        oAuthClientId: cfg.clientId,
        oAuthClientSecret: cfg.clientSecret,
        oAuthClockSkew: REFRESH_MARGIN_S,
        // One cached token, refreshed only near expiry.
        oAuthTokenProvider: () => this.accessToken(),
      },
      httpClientOptions: { timeout: TIMEOUT_MS, retryConfig: { maxNumberOfRetries: 0 } },
      // Route the SDK through fetch so an injected fetch sees every PayPal request.
      unstable_httpClientOptions: { adapter: "fetch", env: { fetch: cfg.fetch ?? fetch } },
    });
    this.orders = new OrdersController(this.client);
    this.payments = new PaymentsController(this.client);
  }

  async createAuthorizationOrder(i: Parameters<PaymentGateway["createAuthorizationOrder"]>[0]) {
    const { result } = await sdk(() =>
      this.orders.createOrder({
        paypalRequestId: `order-${i.mandateId}`,
        body: {
          intent: CheckoutPaymentIntent.Authorize,
          purchaseUnits: [
            {
              customId: i.customId,
              description: i.description,
              // What the buyer sees on their card or bank statement (PayPal allows 22 characters).
              softDescriptor: "ENTOLE LIMIT ORDER",
              // The signed terms as one line item, so the approval page shows what is being signed.
              items: [
                {
                  name: i.description,
                  quantity: "1",
                  unitAmount: { currencyCode: "USD", value: formatUsd(i.amount) },
                  category: ItemCategory.PhysicalGoods,
                },
              ],
              amount: {
                currencyCode: "USD",
                value: formatUsd(i.amount),
                breakdown: { itemTotal: { currencyCode: "USD", value: formatUsd(i.amount) } },
              },
            },
          ],
          paymentSource: {
            paypal: {
              experienceContext: {
                brandName: "Entole",
                locale: "en-US",
                userAction: PaypalExperienceUserAction.Continue,
                // The buyer picks the ship-to address from their PayPal account on the approval page.
                shippingPreference: PaypalWalletContextShippingPreference.GetFromFile,
                returnUrl: i.returnUrl,
                cancelUrl: i.cancelUrl,
                // PayPal asks Entole about the redacted ship-to address while the buyer is still
                // on the approval page, and shows Entole's refusal there.
                ...(i.shippingCallbackUrl
                  ? {
                      orderUpdateCallbackConfig: {
                        callbackEvents: [CallbackEvents.ShippingAddress],
                        callbackUrl: i.shippingCallbackUrl,
                      },
                    }
                  : {}),
              },
            },
          },
        },
      }),
    );
    const approveUrl = result.links?.find((l) => l.rel === "payer-action")?.href;
    if (!result.id || !approveUrl) throw new Error("PayPal order has no payer-action link");
    return { orderId: result.id, approveUrl };
  }

  async authorizeOrder(orderId: string) {
    const { result } = await sdk(() =>
      this.orders.authorizeOrder({ id: orderId, paypalRequestId: `authorize-${orderId}` }),
    );
    const unit = result.purchaseUnits?.[0];
    const auth = unit?.payments?.authorizations?.[0];
    if (!unit || !auth?.id || !auth.amount || !auth.expirationTime)
      throw new Error("PayPal authorize response has no authorization");
    const a = unit.shipping?.address;
    const shipTo =
      a?.countryCode && a.addressLine1
        ? {
            name: unit.shipping?.name?.fullName ?? "",
            lines: [a.addressLine1, a.addressLine2].filter((l): l is string => !!l),
            city: a.adminArea2 ?? "",
            region: a.adminArea1 ?? "",
            postalCode: a.postalCode ?? "",
            country: a.countryCode,
          }
        : undefined;
    return {
      authorizationId: auth.id,
      amount: parseUsd(auth.amount.value),
      expiresAt: new Date(auth.expirationTime),
      customId: unit.customId ?? auth.customId ?? "",
      ...(shipTo ? { shipTo } : {}),
    };
  }

  async capture(i: Parameters<PaymentGateway["capture"]>[0]) {
    let result: CapturedPayment;
    try {
      ({ result } = await sdk(() =>
        this.payments.captureAuthorizedPayment({
          authorizationId: i.authorizationId,
          paypalRequestId: i.idempotencyKey,
          body: {
            amount: { currencyCode: "USD", value: formatUsd(i.amount) },
            finalCapture: i.final,
            invoiceId: i.invoiceId,
            noteToPayer: i.note.slice(0, 255),
          },
        }),
      ));
    } catch (e) {
      // PayPal can refuse the funding source with a 422 instead of a DECLINED capture. Either way
      // no money moved and the answer is final for that request id, so report it as a decline.
      if (e instanceof PayPalError && e.status === 422 && e.issues.some((s) => DECLINES.has(s)))
        return { captureId: "", status: "DECLINED" };
      throw e;
    }
    if (!result.id) throw new Error("PayPal capture response has no id");
    const breakdown = result.sellerReceivableBreakdown;
    return {
      captureId: result.id,
      status: String(result.status ?? "COMPLETED"),
      ...(result.sellerProtection?.status
        ? { sellerProtection: String(result.sellerProtection.status) }
        : {}),
      ...(breakdown?.paypalFee ? { paypalFee: parseUsd(breakdown.paypalFee.value) } : {}),
      ...(breakdown?.netAmount ? { net: parseUsd(breakdown.netAmount.value) } : {}),
    };
  }

  async refundCapture(i: Parameters<PaymentGateway["refundCapture"]>[0]) {
    // No body means a full refund of the capture.
    const { result } = await sdk(() =>
      this.payments.refundCapturedPayment({
        captureId: i.captureId,
        paypalRequestId: i.idempotencyKey,
      }),
    );
    if (!result.id) throw new Error("PayPal refund response has no id");
    return { refundId: result.id };
  }

  async voidAuthorization(authorizationId: string): Promise<void> {
    try {
      await sdk(() =>
        this.payments.voidPayment({ authorizationId, paypalRequestId: `void-${authorizationId}` }),
      );
    } catch (e) {
      // Already voided or expired means the hold is gone, which is what Close wants.
      if (
        e instanceof PayPalError &&
        e.status === 422 &&
        e.issues.some((s) => /VOIDED|EXPIRED/.test(s))
      )
        return;
      throw e;
    }
  }

  // Payments v2 reauthorize. PayPal answers 422 REAUTHORIZATION_TOO_SOON inside the honor period:
  // that is a timing slip, so it throws and the next tick retries. Any other 422 is final.
  async reauthorize(i: Parameters<PaymentGateway["reauthorize"]>[0]) {
    try {
      const { result } = await sdk(() =>
        this.payments.reauthorizePayment({
          authorizationId: i.authorizationId,
          paypalRequestId: i.idempotencyKey,
          body: { amount: { currencyCode: "USD", value: formatUsd(i.amount) } },
        }),
      );
      if (!result.id) throw new Error("PayPal reauthorize response has no id");
      if (String(result.status) === "DENIED")
        return { status: "denied" as const, reason: "DENIED" };
      return { status: "renewed" as const, authorizationId: result.id };
    } catch (e) {
      if (
        e instanceof PayPalError &&
        e.status === 422 &&
        !e.issues.includes("REAUTHORIZATION_TOO_SOON")
      )
        return { status: "denied" as const, reason: e.issues.join(", ") || "UNPROCESSABLE_ENTITY" };
      throw e;
    }
  }

  // Fetches a token only when the cached one is missing or within the refresh margin. Concurrent
  // callers share the in-flight fetch; a failed fetch is dropped so the next call retries.
  private async accessToken(): Promise<OAuthToken> {
    const manager = this.client.clientCredentialsAuthManager;
    const cached = await this.token?.catch(() => undefined);
    if (cached && !manager.isExpired(cached)) return cached;
    const next = manager.fetchToken();
    this.token = next;
    next.catch(() => {
      if (this.token === next) this.token = undefined;
    });
    return next;
  }
}

// Every SDK failure with a status, the token request included, becomes a PayPalError.
const sdk = async <T>(call: () => Promise<T>): Promise<T> => {
  try {
    return await call();
  } catch (e) {
    if (e instanceof ApiError)
      throw toError(e.statusCode, typeof e.body === "string" ? e.body : "");
    throw e;
  }
};

const toError = (status: number, body: string): PayPalError => {
  let debugId: string | undefined;
  let issues: string[] = [];
  try {
    const j = JSON.parse(body) as { debug_id?: string; details?: { issue?: string }[] };
    debugId = j.debug_id;
    issues = (j.details ?? []).flatMap((d) => (d.issue ? [d.issue] : []));
  } catch {
    // non-JSON error body
  }
  return new PayPalError(status, debugId, issues);
};
