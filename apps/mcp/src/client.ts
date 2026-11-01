// The Entole API as the tools see it, called through the SDK generated from docs/openapi.yaml and
// authenticated with a personal access token. Only the fields the tools print are typed.
import {
  ApiError,
  type ApiErrorModel,
  ap2ExportSchema,
  type CreateLimitOrderRequest,
  EntoleApiClient,
  EntoleApiError as SdkError,
} from "@entole/sdk";

export type Candidate = { title: string; merchant: string; baselinePrice: string };

export type Created = { id: string; approveUrl: string; candidates: Candidate[] };

export type Summary = {
  id: string;
  status: string;
  outcome: string;
  query: string;
  limitPrice: string;
  captured: string;
  validUntil: string;
};

// The single-order view nests the signed terms; only the list flattens query and limit.
export type Detail = Omit<Summary, "query" | "limitPrice"> & {
  terms: { query: string; limitPrice: string };
  approveUrl: string | null;
  held: string;
  candidates: Candidate[];
  purchase: { title: string; merchant: string; price: string } | null;
};

export class EntoleApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "EntoleApiError";
  }
}

// Turns the API's fixed error codes into a sentence an assistant can repeat to the user.
const explain = (status: number, body: Record<string, unknown>): string => {
  const code = typeof body.error === "string" ? body.error : `http_${status}`;
  switch (code) {
    case "unauthorized":
      return "Entole rejected the token. Create a new one at /connect and set ENTOLE_TOKEN.";
    case "forbidden":
    case "not_found":
      return "No limit order with that id belongs to this account.";
    case "rate_limited":
      return "Too many requests to Entole. Wait a minute and try again.";
    case "daily_limit_reached":
      return "This account reached its daily limit of new limit orders. Try again tomorrow.";
    case "no_candidates":
      return "The shopping agent found no item that fits these terms. Try a broader query or a higher max price.";
    case "invalid_field":
      return `Entole rejected the field "${String(body.field)}".`;
    default:
      return `Entole answered ${status} (${code}).`;
  }
};

// Every request carries the bearer token, so it only goes over https. Plain http is allowed for a
// local API on localhost or 127.0.0.1.
export const entoleBaseUrl = (raw: string | undefined): string => {
  const value = raw?.trim() || "https://entole.vercel.app";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`ENTOLE_URL is not a valid URL: ${value}`);
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:"))
    throw new Error("ENTOLE_URL must use https (plain http only for localhost or 127.0.0.1)");
  return value;
};

// The SDK hands dates back as Date; the tools print the ISO string the API sent.
const iso = <T extends { validUntil: Date }>(v: T) => ({
  ...v,
  validUntil: v.validUntil.toISOString(),
});

export class EntoleClient {
  private readonly base: string;
  private readonly sdk: EntoleApiClient;

  constructor(baseUrl: string, token: string, fetchFn: typeof fetch = fetch) {
    this.base = baseUrl.replace(/\/+$/, "");
    this.sdk = new EntoleApiClient({
      serverOptions: { baseUrl: this.base },
      bearer: token,
      fetch: fetchFn,
    });
  }

  // The page where the user can watch or approve the order in a browser.
  pageUrl(id: string): string {
    return `${this.base}/mandates/${encodeURIComponent(id)}`;
  }

  // The demo switches stay off: an assistant never plants the trap or replays history.
  createLimitOrder(
    body: Omit<CreateLimitOrderRequest, "demoInjection" | "replay">,
  ): Promise<Created> {
    return this.call(() =>
      this.sdk.createLimitOrder({ body: { ...body, demoInjection: false, replay: false } }),
    );
  }

  async listLimitOrders(): Promise<Summary[]> {
    return (await this.call(() => this.sdk.listLimitOrders())).map(iso);
  }

  async getLimitOrder(id: string): Promise<Detail> {
    return iso(await this.call(() => this.sdk.getLimitOrder({ id })));
  }

  // The order as Agent Payments Protocol mandates, encoded back to the protocol's own snake_case
  // wire form and passed through to the assistant as JSON.
  async getAp2Mandates(id: string): Promise<unknown> {
    const ap2 = await this.call(() => this.sdk.getAp2Mandates({ id }));
    return ap2ExportSchema.encode(ap2);
  }

  async cancelLimitOrder(id: string): Promise<Detail> {
    return iso(await this.call(() => this.sdk.cancelLimitOrder({ id })));
  }

  private async call<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      // Every declared error arm carries the spec's ApiError body; an undeclared status has none.
      if (err instanceof ApiError) {
        const body = "rawBody" in err.payload ? {} : (err.payload.body as ApiErrorModel);
        throw new EntoleApiError(err.status, explain(err.status, body));
      }
      if (!(err instanceof SdkError)) throw err;
      if (err.kind === "connection" || err.kind === "timeout")
        throw new EntoleApiError(
          0,
          `Could not reach Entole at ${this.base}: ${String(err.cause ?? err.message)}`,
        );
      throw new EntoleApiError(
        "status" in err ? err.status : 0,
        `Entole answered in a way this server could not read: ${err.message}`,
      );
    }
  }
}
