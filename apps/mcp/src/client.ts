// A thin HTTP client for the Entole API, authenticated with a personal access token.
// Shapes follow docs/API_CONTRACT.md; only the fields the tools print are typed.

export type Candidate = { title: string; merchant: string; baselinePrice: string };

export type CreateLimitOrder = {
  query: string;
  limitPrice: string;
  brands: string[];
  avoid: string[];
  requiredAttributes: Record<string, string>;
  validDays: number;
};

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
      return "Too many limit orders in the last minute. Wait a minute and try again.";
    case "no_candidates":
      return "The shopping agent found no item that fits these terms. Try a broader query or a higher max price.";
    case "invalid_field":
      return `Entole rejected the field "${String(body.field)}".`;
    case "invalid_state":
      return "That limit order can no longer be cancelled.";
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

export class EntoleClient {
  private readonly base: string;

  constructor(
    baseUrl: string,
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.base = baseUrl.replace(/\/+$/, "");
  }

  // The page where the user can watch or approve the order in a browser.
  pageUrl(id: string): string {
    return `${this.base}/mandates/${encodeURIComponent(id)}`;
  }

  createLimitOrder(body: CreateLimitOrder): Promise<Created> {
    return this.call("POST", "/api/mandates", { ...body, demoInjection: false, replay: false });
  }

  listLimitOrders(): Promise<Summary[]> {
    return this.call("GET", "/api/mandates");
  }

  getLimitOrder(id: string): Promise<Detail> {
    return this.call("GET", `/api/mandates/${encodeURIComponent(id)}`);
  }

  // The order as Agent Payments Protocol mandates; passed through to the assistant as JSON.
  getAp2Mandates(id: string): Promise<unknown> {
    return this.call("GET", `/api/mandates/${encodeURIComponent(id)}/ap2`);
  }

  cancelLimitOrder(id: string): Promise<Detail> {
    return this.call("POST", `/api/mandates/${encodeURIComponent(id)}/close`);
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new EntoleApiError(0, `Could not reach Entole at ${this.base}: ${String(err)}`);
    }
    const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new EntoleApiError(res.status, explain(res.status, parsed));
    return parsed as T;
  }
}
