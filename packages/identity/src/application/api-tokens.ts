import type { Clock, IdGenerator } from "@entole/shared-kernel";
import { generateApiToken, hashApiToken, isApiTokenShape } from "../domain/api-token.ts";
import type { ApiTokenRepository } from "./ports.ts";

export type ApiTokenDeps = { apiTokens: ApiTokenRepository; ids: IdGenerator; clock: Clock };

// Returns the plaintext once; only its hash is kept.
export const issueApiToken = async (
  deps: ApiTokenDeps,
  userId: string,
  name: string,
): Promise<{ id: string; token: string }> => {
  const token = generateApiToken();
  const id = deps.ids.next("tok");
  await deps.apiTokens.create({
    id,
    userId,
    name,
    hash: hashApiToken(token),
    createdAt: deps.clock.now(),
  });
  return { id, token };
};

// The user a bearer token acts for, or null when it is malformed, unknown or revoked.
export const authenticateApiToken = async (
  deps: Omit<ApiTokenDeps, "ids">,
  token: string,
): Promise<string | null> =>
  isApiTokenShape(token) ? deps.apiTokens.use(hashApiToken(token), deps.clock.now()) : null;
