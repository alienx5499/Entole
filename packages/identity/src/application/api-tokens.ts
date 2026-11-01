import type { Clock, IdGenerator } from "@entole/shared-kernel";
import {
  generateApiToken,
  hashApiToken,
  isApiTokenShape,
  MAX_LIVE_TOKENS,
  MAX_TOKEN_NAME,
} from "../domain/api-token.ts";
import type { ApiTokenRepository } from "./ports.ts";

export type ApiTokenDeps = { apiTokens: ApiTokenRepository; ids: IdGenerator; clock: Clock };

export type IssueApiTokenResult =
  | { outcome: "issued"; id: string; token: string }
  | { outcome: "invalid_name" | "too_many_tokens" };

// Returns the plaintext once; only its hash is kept. The name is trimmed first.
export const issueApiToken = async (
  deps: ApiTokenDeps,
  userId: string,
  rawName: string,
): Promise<IssueApiTokenResult> => {
  const name = rawName.trim();
  if (name === "" || name.length > MAX_TOKEN_NAME) return { outcome: "invalid_name" };
  const live = (await deps.apiTokens.listByUser(userId)).filter((t) => !t.revokedAt);
  if (live.length >= MAX_LIVE_TOKENS) return { outcome: "too_many_tokens" };
  const token = generateApiToken();
  const id = deps.ids.next("tok");
  await deps.apiTokens.create({
    id,
    userId,
    name,
    hash: hashApiToken(token),
    createdAt: deps.clock.now(),
  });
  return { outcome: "issued", id, token };
};

// The user a bearer token acts for, or null when it is malformed, unknown or revoked.
export const authenticateApiToken = async (
  deps: Omit<ApiTokenDeps, "ids">,
  token: string,
): Promise<string | null> =>
  isApiTokenShape(token) ? deps.apiTokens.use(hashApiToken(token), deps.clock.now()) : null;
