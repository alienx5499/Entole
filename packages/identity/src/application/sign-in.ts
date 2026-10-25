import type { Clock } from "@entole/shared-kernel";
import { sessionExpiresAt } from "../domain/session.ts";
import type { IdentityProvider, SessionRepository, UserRepository } from "./ports.ts";

export type SignInDeps = {
  identity: IdentityProvider;
  users: UserRepository;
  sessions: SessionRepository;
  clock: Clock;
};

// Trades the provider's one-time code for a user and a new session token.
export const signIn = async (deps: SignInDeps, code: string): Promise<{ token: string }> => {
  const profile = await deps.identity.exchange(code);
  const user = await deps.users.upsertByPaypalId(profile);
  return { token: await deps.sessions.create(user.id, sessionExpiresAt(deps.clock.now())) };
};
