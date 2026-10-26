import { formatUsd, parseUsd } from "@entole/shared-kernel";
import {
  ApiError,
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

const SIGNATURE_HEADERS = [
  "paypal-auth-algo",
  "paypal-cert-url",
  "paypal-transmission-id",
  "paypal-transmission-sig",
  "paypal-transmission-time",
];

// The SDK selects its host by environment and takes no base URL, so PAYPAL_API_BASE maps onto one.
const ENVIRONMENTS: Record<string, Environment> = {
  "https://api-m.sandbox.paypal.com": Environment.Sandbox,
  "https://api-m.paypal.com": Environment.Production,
};

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
// signature verification is not in the SDK, so that one call stays raw HTTP on the SDK's token.
export class PayPalGateway implements PaymentGateway {
  private readonly http: typeof fetch;
  private readonly client: Client;
  private readonly orders: OrdersController;
  private readonly payments: PaymentsController;
  private token?: Promise<OAuthToken>;

  constructor(private readonly cfg: Config) {
    this.http = cfg.fetch ?? fetch;
    const environment = ENVIRONMENTS[cfg.baseUrl.replace(/\/+$/, "")];
    if (!environment) throw new Error(`Unsupported PayPal API base: ${cfg.baseUrl}`);
    this.client = new Client({
      environment,
      timeout: TIMEOUT_MS,
      clientCredentialsAuthCredentials: {
        oAuthClientId: cfg.clientId,
        oAuthClientSecret: cfg.clientSecret,
        oAuthClockSkew: REFRESH_MARGIN_S,
        // One cached token for the SDK and the raw webhook call.
        oAuthTokenProvider: () => this.accessToken(),
      },
      httpClientOptions: { timeout: TIMEOUT_MS, retryConfig: { maxNumberOfRetries: 0 } },
      // Route the SDK through fetch so an injected fetch sees every PayPal request.
      unstable_httpClientOptions: { adapter: "fetch", env: { fetch: this.http } },
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
    const { result } = await sdk(() =>
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
    );
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

  // The event goes into the request byte for byte: re-serializing it can change the bytes PayPal
  // signed. Only SUCCESS counts; FAILURE or an unexpected answer means the delivery is not genuine.
  async verifyWebhookSignature(webhookId: string, headers: Headers, body: string) {
    // Unsigned requests never reach PayPal; they are simply not verified.
    if (SIGNATURE_HEADERS.some((name) => !headers.get(name))) return false;
    const h = (name: string) => JSON.stringify(headers.get(name) ?? "");
    const payload = `{"auth_algo":${h("paypal-auth-algo")},"cert_url":${h("paypal-cert-url")},"transmission_id":${h("paypal-transmission-id")},"transmission_sig":${h("paypal-transmission-sig")},"transmission_time":${h("paypal-transmission-time")},"webhook_id":${JSON.stringify(webhookId)},"webhook_event":${body}}`;
    try {
      const { accessToken } = await sdk(() => this.accessToken());
      const res = await this.http(`${this.cfg.baseUrl}/v1/notifications/verify-webhook-signature`, {
        method: "POST",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          // Verification is a read and needs no idempotency. A fresh id per call, since the
          // transmission id comes from the caller and a reused key could replay a cached answer.
          "PayPal-Request-Id": crypto.randomUUID(),
        },
        body: payload,
      });
      const text = await res.text();
      if (!res.ok) throw toError(res.status, text);
      const json = (text ? JSON.parse(text) : {}) as { verification_status?: string };
      return json.verification_status === "SUCCESS";
    } catch (err) {
      // PayPal rejecting the verification request (4xx) means "not verified". A 5xx or network
      // failure still throws, so the caller answers non-2xx and PayPal retries the delivery.
      if (err instanceof PayPalError && err.status >= 400 && err.status < 500) return false;
      throw err;
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
