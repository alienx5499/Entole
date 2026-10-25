import { formatUsd } from "@entole/shared-kernel";
import type { Mandate } from "../domain/index.ts";
import type { MandateDeps } from "./create-mandate.ts";
import { withMandateLock } from "./mandate-lock.ts";

// Thrown when there is no capture to refund.
export class NotRefundable extends Error {}

// Sandbox refund of the one capture a limit mandate makes. The capture id lives on the
// proposal_allowed audit entry, written in the same step as the capture.
export const refundMandate = (deps: MandateDeps, mandateId: string): Promise<Mandate> =>
  withMandateLock(
    mandateId,
    async () => {
      const current = await deps.repo.get(mandateId);
      if (!current) throw new Error(`Unknown mandate ${mandateId}`);
      if (current.refund) return current;
      const bought = (await deps.repo.listAudit(mandateId)).find(
        (e) => e.kind === "proposal_allowed" && e.data?.captureId,
      );
      const captureId = bought?.data?.captureId;
      if (current.captured.cents <= 0 || !captureId)
        throw new NotRefundable("Nothing was captured");
      const { refundId } = await deps.gateway.refundCapture({
        captureId,
        idempotencyKey: `refund-${mandateId}`,
      });
      const refunded = { ...current, refund: { id: refundId, amount: current.captured } };
      await deps.repo.save(refunded);
      await deps.repo.appendAudit(mandateId, {
        at: deps.clock.now(),
        kind: "refunded",
        message: `Refunded $${formatUsd(current.captured)} (sandbox)`,
        data: { refundId, amount: formatUsd(current.captured) },
      });
      return refunded;
    },
    deps.lock,
  );
