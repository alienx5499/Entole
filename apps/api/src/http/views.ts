import { savingsFor } from "@entole/limit-order";
import {
  type AuditEntry,
  type Candidate,
  type Mandate,
  outcomeOf,
  remaining,
  shopsOf,
  type Verdict,
} from "@entole/mandate";
import { formatUsd, lte } from "@entole/shared-kernel";

// JSON-safe shapes from docs/API_CONTRACT.md: money as decimal strings, dates as ISO strings.

export const candidateView = (c: Candidate) => ({
  productId: c.productId,
  merchant: c.merchant,
  // Every signed shop, `merchant` first; the watcher buys from the cheapest that passes.
  shops: shopsOf(c),
  title: c.title,
  options: c.options,
  baselinePrice: formatUsd(c.baselinePrice),
});

export const verdictView = (v: Verdict) =>
  v.kind === "allow"
    ? { kind: "allow" as const }
    : { kind: "block" as const, reasons: [...v.reasons], details: [...v.details] };

const auditView = (e: AuditEntry) => ({
  at: e.at.toISOString(),
  kind: e.kind,
  message: e.message,
  ...(e.data ? { data: e.data } : {}),
});

const sameCandidate = (c: Candidate, productId?: string, merchant?: string): boolean =>
  c.productId === productId &&
  shopsOf(c).some((shop) => shop.toLowerCase() === (merchant ?? "").toLowerCase());

// No block verdict: the item was never proposed. Its only known price is the baseline from the shortlist.
const unblockedReason = (c: Candidate, m: Mandate, limit: string): string =>
  lte(c.baselinePrice, m.terms.maxUnitPrice)
    ? "Another item was bought first"
    : `Price stayed above your $${limit} limit`;

// "Why this one" comes from the deterministic check details in the audit trail, never from model prose.
const purchaseView = (m: Mandate, audit: AuditEntry[]) => {
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
    price: formatUsd(price),
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
    savings: chosen ? formatUsd(savingsFor(price, chosen.baselinePrice)) : "0.00",
    // A replay mandate buys only through the replay feed while it runs; after a restart the
    // feed falls back to live prices and the label still says replay (the signed mode, not the source).
    inReplay: m.replay,
    whyThisOne: {
      chosen: `${title}: $${formatUsd(price)}, at or below your $${limit} limit`,
      skipped,
    },
  };
};

const atOf = (audit: AuditEntry[], kind: AuditEntry["kind"]): string | null =>
  audit.find((e) => e.kind === kind)?.at.toISOString() ?? null;

// Everything PayPal-side in one place, from the mandate and its audit trail. The custom_id sent
// with the order is the digest (create-mandate.ts), and `fund` rejects a hold whose custom_id differs.
const receiptView = (m: Mandate, audit: AuditEntry[]) => {
  const closed = audit.find((e) => e.kind === "closed");
  return {
    paypalOrderId: audit.find((e) => e.kind === "created")?.data?.orderId ?? null,
    authorizationId: m.authorization?.id ?? null,
    captureId: audit.find((e) => e.kind === "proposal_allowed")?.data?.captureId ?? null,
    refundId: m.refund?.id ?? null,
    customId: m.digest,
    amounts: {
      held: m.authorization ? formatUsd(m.authorization.amount) : "0.00",
      captured: formatUsd(m.captured),
      released: closed?.data?.voided ?? "0.00",
      refunded: m.refund ? formatUsd(m.refund.amount) : "0.00",
    },
    times: {
      approved: atOf(audit, "funded"),
      captured: atOf(audit, "proposal_allowed"),
      released: closed && Number(closed.data?.voided ?? 0) > 0 ? closed.at.toISOString() : null,
      refunded: atOf(audit, "refunded"),
    },
    // Webhook confirmations PayPal sent, verified before they were written.
    confirmations: audit
      .filter((e) => e.kind === "paypal_event")
      .map((e) => ({
        at: e.at.toISOString(),
        eventType: e.data?.eventType ?? "",
        message: e.message,
        eventId: e.data?.eventId ?? "",
      })),
  };
};

// `approveUrl` is passed only by owner routes, and only while the mandate awaits approval.
// One row of the "Your limit orders" list.
export const mandateSummaryView = (m: Mandate, now: Date) => ({
  id: m.id,
  status: m.status,
  outcome: outcomeOf(m, now),
  query: m.terms.item.query,
  limitPrice: formatUsd(m.terms.maxUnitPrice),
  captured: formatUsd(m.captured),
  createdAt: m.createdAt.toISOString(),
  validUntil: m.terms.validUntil.toISOString(),
});

export const mandateView = (
  m: Mandate,
  audit: AuditEntry[],
  approveUrl: string | null,
  now: Date,
) => ({
  id: m.id,
  status: m.status,
  outcome: outcomeOf(m, now),
  kind: m.terms.kind,
  digest: m.digest,
  createdAt: m.createdAt.toISOString(),
  validUntil: m.terms.validUntil.toISOString(),
  terms: {
    query: m.terms.item.query,
    brands: m.terms.item.brands,
    avoid: m.terms.item.avoid,
    requiredAttributes: m.terms.item.requiredAttributes,
    limitPrice: formatUsd(m.terms.maxUnitPrice),
    budget: formatUsd(m.terms.budget),
    allowedMerchants: m.terms.allowedMerchants,
  },
  candidates: m.terms.candidates.map(candidateView),
  rejected: m.rejected,
  approveUrl: m.status === "awaiting_approval" ? approveUrl : null,
  held: m.authorization ? formatUsd(m.authorization.amount) : "0.00",
  captured: formatUsd(m.captured),
  remaining: formatUsd(remaining(m)),
  voided: m.voided,
  authorizationId: m.authorization?.id ?? null,
  demoInjection: m.demoInjection,
  replay: m.replay,
  purchase: purchaseView(m, audit),
  receipt: receiptView(m, audit),
  audit: audit.map(auditView),
  sandbox: true as const,
});
