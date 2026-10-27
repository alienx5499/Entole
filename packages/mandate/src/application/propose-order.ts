import { formatUsd } from "@entole/shared-kernel";
import { checkProposal, type ResolvedOffer, recordCapture, type Verdict } from "../domain/index.ts";
import type { MandateDeps } from "./create-mandate.ts";
import { withMandateLock } from "./mandate-lock.ts";
import type { CaptureResult, ProductSearch } from "./ports.ts";

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
          const last = await deps.repo.lastBlocked(mandate.id, i.productId, i.merchant);
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

      // A limit mandate buys once, so its capture is final and PayPal releases the rest at once.
      const final = mandate.terms.kind === "limit";
      const audit = await deps.repo.listAudit(mandate.id);
      const n =
        audit.filter((e) => e.kind === "proposal_allowed" || e.kind === "capture_failed").length +
        1;
      // PayPal answered DECLINED or FAILED before: that answer is final for its request id, so the
      // next attempt needs a new one. Timeouts and errors keep the same id so a retry cannot double charge.
      const declines = audit.filter(
        (e) => e.kind === "capture_failed" && e.data?.paypalStatus !== undefined,
      ).length;
      let result: CaptureResult;
      try {
        result = await deps.gateway.capture({
          authorizationId: mandate.authorization.id,
          amount: offer.price,
          // A limit mandate captures once, so a retry after a timeout or a failed save reuses the
          // PayPal-Request-Id and replays the first capture instead of charging again.
          idempotencyKey:
            mandate.terms.kind === "limit"
              ? `${mandate.id}-capture${declines > 0 ? `-${declines}` : ""}`
              : deps.ids.next("prop"),
          invoiceId: `${mandate.id}-${n}`,
          final,
          note: `Entole: ${offer.title} from ${offer.merchant} for $${formatUsd(offer.price)}, within your signed limit.`,
        });
      } catch (err) {
        return failed(deps, mandate.id, offer, "Payment provider error, nothing was charged", {
          ...data,
          error: err instanceof Error ? err.message.slice(0, 200) : "unknown error",
        });
      }
      if (result.status === "DECLINED" || result.status === "FAILED")
        return failed(
          deps,
          mandate.id,
          offer,
          `PayPal ${result.status.toLowerCase()} the capture, nothing was charged`,
          {
            ...data,
            paypalStatus: result.status,
            captureId: result.captureId,
          },
        );
      const { captureId } = result;
      await deps.repo.save(recordCapture(mandate, offer.price, final));
      const bought =
        i.shopsCompared === undefined
          ? `Bought ${offer.title} for $${formatUsd(offer.price)}`
          : `Bought ${offer.title} for $${formatUsd(offer.price)} from ${offer.merchant}, the cheapest of ${i.shopsCompared} shops compared`;
      await deps.repo.appendAudit(mandate.id, {
        at: deps.clock.now(),
        kind: "proposal_allowed",
        message:
          result.status === "PENDING"
            ? `${bought}; PayPal is still completing the payment`
            : bought,
        data: {
          ...data,
          captureId,
          paypalStatus: result.status,
          ...(result.sellerProtection ? { sellerProtection: result.sellerProtection } : {}),
          ...(result.paypalFee ? { paypalFee: formatUsd(result.paypalFee) } : {}),
          ...(result.net ? { net: formatUsd(result.net) } : {}),
        },
      });
      return { verdict, offer, captureId };
    },
    deps.lock,
  );

// Records a capture that moved no money and returns the block the caller shows.
const failed = async (
  deps: ProposeOrderDeps,
  mandateId: string,
  offer: ResolvedOffer,
  message: string,
  data: Record<string, string>,
): Promise<{ verdict: Verdict; offer: ResolvedOffer }> => {
  await deps.repo.appendAudit(mandateId, {
    at: deps.clock.now(),
    kind: "capture_failed",
    message,
    data,
  });
  return { verdict: { kind: "block", reasons: [], details: [message] }, offer };
};
