import type {
  ApiTokenView,
  CheckNowResponse,
  CreatedApiToken,
  CreateMandateRequest,
  CreateMandateResponse,
  MandateSummary,
  MandateView,
  MeView,
  PricesResponse,
  RejectedView,
  ReplayStartResponse,
  SimulateResponse,
} from "./types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly error: string,
    readonly field?: string,
    readonly rejected?: RejectedView[],
  ) {
    super(error);
    this.name = "ApiError";
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  redirectOn401 = true,
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    if (res.status === 401 && redirectOn401 && window.location.pathname !== "/") {
      window.location.href = "/?login=1";
    }
    const e = ((await res.json().catch(() => null)) ?? {}) as {
      error?: string;
      field?: string;
      rejected?: RejectedView[];
    };
    throw new ApiError(res.status, e.error ?? res.statusText, e.field, e.rejected);
  }
  return (await res.json().catch(() => null)) as T;
}

export const getMe = (opts?: { redirectOn401?: boolean }) =>
  request<MeView>("GET", "/me", undefined, opts?.redirectOn401 ?? true);
// One login check per page load, shared by the header, the homepage and the boot splash, so they
// all show the same state at once. Login and logout both reload the page, which resets it.
let session: Promise<MeView> | undefined;
export const getSession = () => {
  session ??= getMe({ redirectOn401: false });
  return session;
};
export const logout = () => request<{ ok: true }>("POST", "/auth/logout");
export const createMandate = (input: CreateMandateRequest) =>
  request<CreateMandateResponse>("POST", "/mandates", input);
export const listMandates = () => request<MandateSummary[]>("GET", "/mandates");
// Every order as a full view in one call, for the pages that show them all.
export const listMandateViews = () => request<MandateView[]>("GET", "/mandates?full=1");
// The id comes from the URL, so it is encoded: a crafted link must not reach another /api path.
const mandatePath = (id: string) => `/mandates/${encodeURIComponent(id)}`;
export const getMandate = (id: string) => request<MandateView>("GET", mandatePath(id));
export const checkNow = (id: string) =>
  request<CheckNowResponse>("POST", `${mandatePath(id)}/check-now`);
export const startReplay = (id: string) =>
  request<ReplayStartResponse>("POST", `${mandatePath(id)}/replay/start`);
export const getPrices = (id: string) =>
  request<PricesResponse>("GET", `${mandatePath(id)}/prices`);
export const simulate = (id: string) =>
  request<SimulateResponse>("POST", `${mandatePath(id)}/simulate`);
export const refundMandate = (id: string) =>
  request<MandateView>("POST", `${mandatePath(id)}/refund`);
export const closeMandate = (id: string) =>
  request<MandateView>("POST", `${mandatePath(id)}/close`);
// With no `at` the watcher picks the time; only the buyer's session may decide.
export const proposeCheck = (id: string, at?: string) =>
  request<MandateView>("POST", `${mandatePath(id)}/schedule/propose`, at ? { at } : {});
export const decideCheck = (id: string, accept: boolean, at?: string) =>
  request<MandateView>("POST", `${mandatePath(id)}/schedule/decide`, { accept, at });
export const listTokens = () => request<ApiTokenView[]>("GET", "/tokens");
export const createToken = (name: string) => request<CreatedApiToken>("POST", "/tokens", { name });
export const revokeToken = (id: string) =>
  request<{ ok: true }>("DELETE", `/tokens/${encodeURIComponent(id)}`);
