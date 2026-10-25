import { formatUsd } from "@entole/shared-kernel";
import { checkProposal, type ResolvedOffer, recordCapture, type Verdict } from "../domain/index.ts";
import type { MandateDeps } from "./create-mandate.ts";
import { withMandateLock } from "./mandate-lock.ts";
import type { ProductSearch } from "./ports.ts";

export type ProposeOrderDeps = MandateDeps & { search: ProductSearch };

export const proposeOrder = (
  deps: ProposeOrderDeps,
  i: {
    mandateId: string;
    productId: string;
    merchant: string;
    options: Record<string, string>;
    source: "agent" | "simulated" | "watcher";
    // How many signed shops the watcher quoted before proposing this one, the cheapest passing.
    shopsCompared?: number;
  },
): Promise<{ verdict: Verdict; offer: ResolvedOffer | null; captureId?: string }> =>
  withMandateLock(
    i.mandateId,
    async () => {
      const mandate = await deps.repo.get(i.mandateId);
      if (!mandate) throw new Error(`Unknown mandate ${i.mandateId}`);
      const offer = await deps.search.resolveOffer({
        productId: i.productId,
        merchant: i.merchant,
        options: i.options,
      });
      const verdict = checkProposal(mandate, offer, deps.clock.now(), {
        productId: i.productId,
        merchant: i.merchant,
        options: i.options,
      });
      const data = {
        source: i.source,
        productId: i.productId,
        merchant: i.merchant,
        ...(i.shopsCompared === undefined ? {} : { shopsCompared: String(i.shopsCompared) }),
      };

      if (verdict.kind === "block") {
        // The hourly watcher re-checks the same shops; a shop blocked for the same reason as last
        // time is not logged again, so the timeline shows changes instead of one line per tick.
        const message = verdict.details.join("; ");
        if (i.source === "watcher") {
          const last = (await deps.repo.listAudit(mandate.id))
            .reverse()
            .find(
              (e) =>
                e.kind === "proposal_blocked" &&
                e.data?.productId === i.productId &&
                e.data?.merchant === i.merchant,
            );
          if (last?.message === message) return { verdict, offer };
        }
        await deps.repo.appendAudit(mandate.id, {
          at: deps.clock.now(),
          kind: "proposal_blocked",
          message,
          data: { ...data, reasons: verdict.reasons.join(",") },
        });
        return { verdict, offer };
      }
      if (!offer || !mandate.authorization)
        throw new Error("Invariant: an allowed proposal needs an offer and an authorization");

      const n =
        (await deps.repo.listAudit(mandate.id)).filter(
          (e) => e.kind === "proposal_allowed" || e.kind === "capture_failed",
        ).length + 1;
      let captureId: string;
      try {
        ({ captureId } = await deps.gateway.capture({
          authorizationId: mandate.authorization.id,
          amount: offer.price,
          // A limit mandate captures once, so a retry after a timeout or a failed save reuses the
          // PayPal-Request-Id and replays the first capture instead of charging again.
          idempotencyKey:
            mandate.terms.kind === "limit" ? `${mandate.id}-capture` : deps.ids.next("prop"),
          invoiceId: `${mandate.id}-${n}`,
        }));
      } catch (err) {
        await deps.repo.appendAudit(mandate.id, {
          at: deps.clock.now(),
          kind: "capture_failed",
          message: "Payment provider error, nothing was charged",
          data: {
            ...data,
            error: err instanceof Error ? err.message.slice(0, 200) : "unknown error",
          },
        });
        return {
          verdict: {
            kind: "block",
            reasons: [],
            details: ["Payment provider error, nothing was charged"],
          },
          offer,
        };
      }
      await deps.repo.save(recordCapture(mandate, offer.price));
      await deps.repo.appendAudit(mandate.id, {
        at: deps.clock.now(),
        kind: "proposal_allowed",
        message:
          i.shopsCompared === undefined
            ? `Bought ${offer.title} for $${formatUsd(offer.price)}`
            : `Bought ${offer.title} for $${formatUsd(offer.price)} from ${offer.merchant}, the cheapest of ${i.shopsCompared} shops compared`,
        data: { ...data, captureId },
      });
      return { verdict, offer, captureId };
    },
    deps.lock,
  );
