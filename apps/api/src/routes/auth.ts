import { randomBytes, timingSafeEqual } from "node:crypto";
import { authenticateApiToken, SESSION_MAX_AGE_SEC, signIn } from "@entole/identity";
import { getTaste } from "@entole/shopping";
import { HttpError, json, parseCookies, redirect, serializeCookie } from "../http/http.ts";
import { clientIp } from "../http/rate-limit.ts";
import type { Route, RouteContext } from "../http/router.ts";

export const SESSION_COOKIE = "entole_session";
const STATE_COOKIE = "entole_oauth_state";
const STATE_MAX_AGE_SEC = 600;
const STATE_PATH = "/api/auth";
const NEXT_COOKIE = "entole_oauth_next";
// Only the PayPal checkout return may be resumed after login, so `next` is never an open redirect.
const RESUMABLE = "/api/paypal/return?";

const safeNext = (v: string | null | undefined): string | null =>
  v?.startsWith(RESUMABLE) ? v : null;

export const currentUserId = async (ctx: RouteContext): Promise<string | null> => {
  const token = parseCookies(ctx.req.headers.get("cookie"))[SESSION_COOKIE];
  return token ? ctx.c.sessions.userIdFor(token, ctx.c.clock.now()) : null;
};

export const requireUserId = async (ctx: RouteContext): Promise<string> => {
  const id = await currentUserId(ctx);
  if (!id) throw new HttpError(401, "unauthorized");
  return id;
};

// For the few routes an AI client may call: a `Bearer ent_...` header, else the session cookie.
// A bearer header that does not authenticate is a 401; it never falls back to the cookie.
export const requireCaller = async (ctx: RouteContext): Promise<string> => {
  const auth = ctx.req.headers.get("authorization");
  if (auth === null) return requireUserId(ctx);
  const m = /^Bearer\s+(\S+)$/i.exec(auth);
  const id = m?.[1] ? await authenticateApiToken(ctx.c, m[1]) : null;
  if (!id) throw new HttpError(401, "unauthorized");
  return id;
};

// Constant-time string compare for secrets and one-time values.
export const sameSecret = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const start: Route[2] = async (ctx) => {
  if (!ctx.limits.signIn.hit(clientIp(ctx.req)) || !ctx.limits.signInAll.hit("all"))
    throw new HttpError(429, "rate_limited");
  const state = randomBytes(24).toString("hex");
  const opts = { maxAgeSec: STATE_MAX_AGE_SEC, secure: ctx.c.secureCookies, path: STATE_PATH };
  const next = safeNext(ctx.url.searchParams.get("next"));
  const cookies = [serializeCookie(STATE_COOKIE, state, opts)];
  if (next) cookies.push(serializeCookie(NEXT_COOKIE, next, opts));
  return redirect(ctx.c.identity.authorizeUrl(state), cookies);
};

const callback: Route[2] = async (ctx) => {
  if (!ctx.limits.signIn.hit(clientIp(ctx.req)) || !ctx.limits.signInAll.hit("all"))
    throw new HttpError(429, "rate_limited");
  const cookies = parseCookies(ctx.req.headers.get("cookie"));
  const expected = cookies[STATE_COOKIE];
  const state = ctx.url.searchParams.get("state");
  const code = ctx.url.searchParams.get("code");
  if (!expected || !state || !sameSecret(expected, state))
    throw new HttpError(400, "invalid_state");
  if (!code) throw new HttpError(400, "missing_code");
  const { token } = await signIn(ctx.c, code);
  const secure = ctx.c.secureCookies;
  return redirect(safeNext(cookies[NEXT_COOKIE]) ?? "/mandates/new", [
    serializeCookie(SESSION_COOKIE, token, { maxAgeSec: SESSION_MAX_AGE_SEC, secure }),
    serializeCookie(STATE_COOKIE, "", { maxAgeSec: 0, secure, path: STATE_PATH }),
    serializeCookie(NEXT_COOKIE, "", { maxAgeSec: 0, secure, path: STATE_PATH }),
  ]);
};

const logout: Route[2] = async (ctx) => {
  const token = parseCookies(ctx.req.headers.get("cookie"))[SESSION_COOKIE];
  if (token) await ctx.c.sessions.revoke(token);
  const headers = new Headers();
  headers.append(
    "Set-Cookie",
    serializeCookie(SESSION_COOKIE, "", { maxAgeSec: 0, secure: ctx.c.secureCookies }),
  );
  return json({ ok: true }, 200, headers);
};

const me: Route[2] = async (ctx) => {
  const userId = await requireCaller(ctx);
  const user = await ctx.c.users.get(userId);
  if (!user) throw new HttpError(401, "unauthorized");
  return json({
    user: { id: user.id, email: user.email, name: user.name },
    taste: await getTaste(ctx.c, userId),
  });
};

export const authRoutes: Route[] = [
  ["GET", "/api/auth/paypal/start", start],
  ["GET", "/api/auth/paypal/callback", callback],
  ["POST", "/api/auth/logout", logout],
  ["GET", "/api/me", me],
];
