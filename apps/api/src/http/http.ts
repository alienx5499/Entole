import { PayPalIdentityError } from "@entole/identity";
import {
  AmountMismatch,
  DigestMismatch,
  InvalidTransition,
  PayPalError,
  ReleaseFailed,
} from "@entole/mandate";
import { Channel3Error, GroqError, RateLimited } from "@entole/shopping";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly error: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(error);
    this.name = "HttpError";
  }
}

export const json = (body: unknown, status = 200, headers?: Headers): Response => {
  const h = new Headers(headers);
  h.set("Content-Type", "application/json");
  h.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(body), { status, headers: h });
};

export const redirect = (location: string, cookies: string[] = []): Response => {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers });
};

export const parseCookies = (header: string | null): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at < 0) continue;
    const name = part.slice(0, at).trim();
    try {
      out[name] = decodeURIComponent(part.slice(at + 1).trim());
    } catch {
      // A malformed cookie value is treated as absent.
    }
  }
  return out;
};

export type CookieOptions = { maxAgeSec: number; secure: boolean; path?: string };

// Always httpOnly and SameSite=Lax: Lax still sends the cookie on the top-level redirect back
// from PayPal, which the login and checkout returns need.
export const serializeCookie = (name: string, value: string, o: CookieOptions): string =>
  [
    `${name}=${encodeURIComponent(value)}`,
    `Max-Age=${o.maxAgeSec}`,
    `Path=${o.path ?? "/"}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(o.secure ? ["Secure"] : []),
  ].join("; ");

const statusFor = (err: unknown): [number, string] => {
  if (err instanceof DigestMismatch || err instanceof AmountMismatch)
    return [409, "funding_mismatch"];
  if (err instanceof InvalidTransition) return [409, "invalid_state"];
  if (err instanceof RangeError) return [400, "invalid_request"];
  if (err instanceof RateLimited) return [429, "upstream_rate_limited"];
  if (err instanceof ReleaseFailed) return [502, "release_failed"];
  if (
    err instanceof PayPalError ||
    err instanceof PayPalIdentityError ||
    err instanceof Channel3Error ||
    err instanceof GroqError
  )
    return [502, "upstream_error"];
  return [500, "internal_error"];
};

// Known errors map to a status and a fixed code; stacks and upstream messages stay server-side.
export const errorResponse = (err: unknown): Response => {
  if (err instanceof HttpError) {
    // The per-minute windows reset within 60 s; daily caps use their own error codes and get no hint.
    const headers = err.error === "rate_limited" ? new Headers({ "Retry-After": "60" }) : undefined;
    return json({ error: err.error, ...err.extra }, err.status, headers);
  }
  const [status, error] = statusFor(err);
  console.error(err);
  return json({ error }, status);
};
