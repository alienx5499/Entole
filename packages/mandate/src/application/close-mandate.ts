import { formatUsd, usd } from "@entole/shared-kernel";
import { close, type Mandate, remaining } from "../domain/index.ts";
import type { MandateDeps } from "./create-mandate.ts";
import { withMandateLock } from "./mandate-lock.ts";

export const MAX_VOID_ATTEMPTS = 3;

// Thrown once a mandate's void has failed MAX_VOID_ATTEMPTS times; nothing retries it after that.
export class ReleaseFailed extends Error {}

export const closeMandate = (deps: MandateDeps, mandateId: string): Promise<Mandate> =>
  withMandateLock(
    mandateId,
    async () => {
      const current = await deps.repo.get(mandateId);
      if (!current) throw new Error(`Unknown mandate ${mandateId}`);
      if (current.status === "closed") return current;
      const attempts = current.voidAttempts ?? 0;
      if (attempts >= MAX_VOID_ATTEMPTS) throw new ReleaseFailed("Release failed; contact support");
      const { mandate, voidNeeded } = close(current);
      // Void first: if PayPal fails the mandate stays open (only the attempt count moves) so a retry can void.
      if (voidNeeded && current.authorization) {
        try {
          await deps.gateway.voidAuthorization(current.authorization.id);
        } catch (err) {
          await deps.repo.save({ ...current, voidAttempts: attempts + 1 });
          if (attempts + 1 < MAX_VOID_ATTEMPTS) throw err;
          await deps.repo.appendAudit(mandateId, {
            at: deps.clock.now(),
            kind: "capture_failed",
            message: "Release failed; contact support",
            data: { error: err instanceof Error ? err.message.slice(0, 200) : "unknown error" },
          });
          throw new ReleaseFailed("Release failed; contact support");
        }
      }
      await deps.repo.save(mandate);
      const released = voidNeeded ? remaining(current) : usd(0);
      await deps.repo.appendAudit(mandateId, {
        at: deps.clock.now(),
        kind: "closed",
        message: voidNeeded
          ? `Mandate closed, $${formatUsd(released)} released`
          : "Mandate closed, nothing left to release",
        data: { voided: formatUsd(released) },
      });
      return mandate;
    },
    deps.lock,
  );
