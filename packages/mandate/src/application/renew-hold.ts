import { type Mandate, needsRenewal, renewHold } from "../domain/index.ts";
import type { MandateDeps } from "./create-mandate.ts";
import { withMandateLock } from "./mandate-lock.ts";

export type RenewOutcome = "renewed" | "denied" | "not_due";

// Called by the watcher on every tick. Renews the PayPal hold once its honor period has lapsed and
// the order is still open. On "denied" the caller closes the mandate, which voids the old hold.
export const renewMandateHold = (deps: MandateDeps, mandateId: string): Promise<RenewOutcome> =>
  withMandateLock(
    mandateId,
    async () => {
      const current = await deps.repo.get(mandateId);
      if (!current) throw new Error(`Unknown mandate ${mandateId}`);
      const now = deps.clock.now();
      if (!needsRenewal(current, now) || !current.authorization) return "not_due";
      const previous = current.authorization.id;
      const result = await deps.gateway.reauthorize({
        authorizationId: previous,
        amount: current.authorization.amount,
        idempotencyKey: `reauthorize-${previous}`,
      });
      if (result.status === "denied") {
        await deps.repo.appendAudit(mandateId, {
          at: now,
          kind: "agent_step",
          message: "PayPal declined to renew the hold, the order ends here",
          data: { authorizationId: previous, reason: result.reason.slice(0, 200) },
        });
        return "denied";
      }
      const renewed: Mandate = renewHold(current, result.authorizationId, now);
      await deps.repo.save(renewed);
      await deps.repo.appendAudit(mandateId, {
        at: now,
        kind: "hold_renewed",
        message: "Hold renewed, PayPal guarantees the funds for 3 more days",
        data: { authorizationId: result.authorizationId, previousAuthorizationId: previous },
      });
      return "renewed";
    },
    deps.lock,
  );
