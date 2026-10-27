import { fund, InvalidTransition, type Mandate } from "../domain/index.ts";
import type { MandateDeps } from "./create-mandate.ts";
import { withMandateLock } from "./mandate-lock.ts";

// Only the money side, under the lock. The caller runs the follow-ups (taste, price tracking)
// after it returns: neither binds money, so a hiccup in either must not fail the funding.
export const fundMandate = (
  deps: MandateDeps,
  i: { mandateId: string; orderId: string },
): Promise<Mandate> =>
  withMandateLock(
    i.mandateId,
    async () => {
      const linked = await deps.repo.findByOrderId(i.orderId);
      if (!linked || linked.id !== i.mandateId)
        throw new Error("Order does not belong to this mandate");
      // Check before authorizing: a hold placed on a closed mandate would have nothing to void it.
      if (linked.status !== "awaiting_approval")
        throw new InvalidTransition(`Cannot fund a ${linked.status} mandate`);
      const auth = await deps.gateway.authorizeOrder(i.orderId);
      let funded: Mandate;
      try {
        funded = fund(linked, {
          id: auth.authorizationId,
          amount: auth.amount,
          expiresAt: auth.expiresAt,
          customId: auth.customId,
          authorizedAt: deps.clock.now(),
        });
      } catch (err) {
        // The hold exists at PayPal but the mandate rejected it: release it, then surface the error.
        await deps.gateway.voidAuthorization(auth.authorizationId);
        throw err;
      }
      await deps.repo.save(funded);
      await deps.repo.appendAudit(funded.id, {
        at: deps.clock.now(),
        kind: "funded",
        message: "PayPal approved the hold, mandate is funded",
        data: { authorizationId: auth.authorizationId },
      });
      return funded;
    },
    deps.lock,
  );
