import { formatUsd, lte, type Money, usd } from "@entole/shared-kernel";
import {
  type AuditEntry,
  type Candidate,
  type Mandate,
  type ShipTo,
  savingsFor,
  shopsOf,
} from "../domain/index.ts";

// Read side of a mandate's money trail, built from the mandate and its audit. It reads nothing and
// writes nothing; the API formats the money and dates.

export type PurchaseSummary = {
  productId: string;
  title: string;
  merchant: string;
  shopsCompared: number;
  price: Money;
  captureId: string;
  paypal: {
    status: string | null;
    sellerProtection: string | null;
    fee: string | null;
    net: string | null;
  };
  shipTo: ShipTo | null;
  savings: Money;
  inReplay: boolean;
  whyThisOne: { chosen: string; skipped: { title: string; reasons: string[] }[] };
};

export type MandateReceipt = {
  paypalOrderId: string | null;
  authorizationId: string | null;
  captureId: string | null;
  refundId: string | null;
  customId: string;
  holdRenewed: { at: Date; authorizationId: string; previousAuthorizationId: string } | null;
  // `released` is the decimal the close step recorded.
  amounts: { held: Money; captured: Money; released: string; refunded: Money };
  times: {
    approved: Date | null;
    captured: Date | null;
    released: Date | null;
    refunded: Date | null;
  };
  confirmations: { at: Date; eventType: string; message: string; eventId: string }[];
};

const sameCandidate = (c: Candidate, productId?: string, merchant?: string): boolean =>
  c.productId === productId &&
  shopsOf(c).some((shop) => shop.toLowerCase() === (merchant ?? "").toLowerCase());

// No block verdict: the item was never proposed. Its only known price is the baseline from the shortlist.
const unblockedReason = (c: Candidate, m: Mandate, limit: string): string =>
  lte(c.baselinePrice, m.terms.maxUnitPrice)
    ? "Another item was bought first"
    : `Price stayed above your $${limit} limit`;

// "Why this one" comes from the deterministic check details in the audit trail, never from model prose.
export const purchaseSummary = (m: Mandate, audit: AuditEntry[]): PurchaseSummary | null => {
  const at = audit.findIndex((e) => e.kind === "proposal_allowed");
  const bought = audit[at];
  if (!bought) return null;
  const chosen = m.terms.candidates.find((c) =>
    sameCandidate(c, bought.data?.productId, bought.data?.merchant),
  );
  // A limit mandate captures exactly once, so the captured total is the item price.
  const price = m.captured;
  const limit = formatUsd(m.terms.maxUnitPrice);
  const title = chosen?.title ?? bought.data?.productId ?? "";
  const skipped = m.terms.candidates
    .filter((c) => c !== chosen)
    .map((c) => {
      const lastBlock = audit
        .slice(0, at)
        .reverse()
        .find(
          (e) =>
            e.kind === "proposal_blocked" && sameCandidate(c, e.data?.productId, e.data?.merchant),
        );
      return {
        title: c.title,
        reasons: lastBlock ? lastBlock.message.split("; ") : [unblockedReason(c, m, limit)],
      };
    });
  return {
    productId: bought.data?.productId ?? "",
    title,
    merchant: bought.data?.merchant ?? "",
    // Shops with a live quote when it was bought; 1 for purchases made before shops were compared.
    shopsCompared: Number(bought.data?.shopsCompared ?? 1),
    price,
    captureId: bought.data?.captureId ?? "",
    // PayPal's own answer on the capture; absent on purchases made before it was recorded.
    paypal: {
      status: bought.data?.paypalStatus ?? null,
      sellerProtection: bought.data?.sellerProtection ?? null,
      fee: bought.data?.paypalFee ?? null,
      net: bought.data?.net ?? null,
    },
    // Where it ships, from the PayPal approval. Entole does not place the shop order in this demo.
    shipTo: m.shipTo ?? null,
    savings: chosen ? savingsFor(price, chosen.baselinePrice) : usd(0),
    // A replay mandate buys only through the replay feed while it runs; after a restart the
    // feed falls back to live prices and the label still says replay (the signed mode, not the source).
    inReplay: m.replay,
    whyThisOne: {
      chosen: `${title}: $${formatUsd(price)}, at or below your $${limit} limit`,
      skipped,
    },
  };
};

const atOf = (audit: AuditEntry[], kind: AuditEntry["kind"]): Date | null =>
  audit.find((e) => e.kind === kind)?.at ?? null;

// Everything PayPal-side in one place. The custom_id sent with the order is the digest
// (create-mandate.ts), and `fund` rejects a hold whose custom_id differs.
export const mandateReceipt = (m: Mandate, audit: AuditEntry[]): MandateReceipt => {
  const closed = audit.find((e) => e.kind === "closed");
  const renewed = audit.find((e) => e.kind === "hold_renewed");
  return {
    paypalOrderId: audit.find((e) => e.kind === "created")?.data?.orderId ?? null,
    authorizationId: m.authorization?.id ?? null,
    captureId: audit.find((e) => e.kind === "proposal_allowed")?.data?.captureId ?? null,
    refundId: m.refund?.id ?? null,
    customId: m.digest,
    // Set once the watcher renewed the hold after PayPal's 3-day honor period.
    holdRenewed: renewed
      ? {
          at: renewed.at,
          authorizationId: renewed.data?.authorizationId ?? "",
          previousAuthorizationId: renewed.data?.previousAuthorizationId ?? "",
        }
      : null,
    amounts: {
      held: m.authorization?.amount ?? usd(0),
      captured: m.captured,
      released: closed?.data?.voided ?? "0.00",
      refunded: m.refund?.amount ?? usd(0),
    },
    times: {
      approved: atOf(audit, "funded"),
      captured: atOf(audit, "proposal_allowed"),
      released: closed && Number(closed.data?.voided ?? 0) > 0 ? closed.at : null,
      refunded: atOf(audit, "refunded"),
    },
    // Webhook confirmations PayPal sent, verified before they were written.
    confirmations: audit
      .filter((e) => e.kind === "paypal_event")
      .map((e) => ({
        at: e.at,
        eventType: e.data?.eventType ?? "",
        message: e.message,
        eventId: e.data?.eventId ?? "",
      })),
  };
};
