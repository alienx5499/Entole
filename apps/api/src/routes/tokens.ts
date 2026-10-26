import { issueApiToken } from "@entole/identity";
import { HttpError, json } from "../http/http.ts";
import type { Route } from "../http/router.ts";
import { readJson } from "../http/validation.ts";
import { requireUserId } from "./auth.ts";

// Personal access tokens are managed from the browser session only: a token cannot mint,
// list or revoke tokens.
const MAX_NAME = 60;
const MAX_LIVE = 20;

const create: Route[2] = async (ctx) => {
  const userId = await requireUserId(ctx);
  const body = (await readJson(ctx.req)) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (name === "" || name.length > MAX_NAME)
    throw new HttpError(400, "invalid_field", { field: "name" });
  const live = (await ctx.c.apiTokens.listByUser(userId)).filter((t) => !t.revokedAt);
  if (live.length >= MAX_LIVE) throw new HttpError(409, "too_many_tokens");
  return json(await issueApiToken(ctx.c, userId, name));
};

const list: Route[2] = async (ctx) => {
  const userId = await requireUserId(ctx);
  return json(
    (await ctx.c.apiTokens.listByUser(userId)).map((t) => ({
      id: t.id,
      name: t.name,
      createdAt: t.createdAt.toISOString(),
      lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
      revokedAt: t.revokedAt?.toISOString() ?? null,
    })),
  );
};

const revoke: Route[2] = async (ctx) => {
  const userId = await requireUserId(ctx);
  const ok = await ctx.c.apiTokens.revoke(userId, ctx.params.id ?? "", ctx.c.clock.now());
  if (!ok) throw new HttpError(404, "not_found");
  return json({ ok: true });
};

export const tokenRoutes: Route[] = [
  ["POST", "/api/tokens", create],
  ["GET", "/api/tokens", list],
  ["DELETE", "/api/tokens/:id", revoke],
];
