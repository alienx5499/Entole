import type { PriceStats } from "@entole/limit-order";
import {
  type AuditEntry,
  type Candidate,
  latestCheckAt,
  type Mandate,
  mandateReceipt,
  outcomeOf,
  purchaseSummary,
  remaining,
  shopsOf,
  type Verdict,
} from "@entole/mandate";
import { formatUsd } from "@entole/shared-kernel";

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

export const priceStatsView = (s: PriceStats | null) =>
  s && {
    low: formatUsd(s.low),
    high: formatUsd(s.high),
    current: formatUsd(s.current),
    aboveLowPercent: s.aboveLowPercent,
  };

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

const iso = (d: Date | null): string | null => d?.toISOString() ?? null;

const purchaseView = (m: Mandate, audit: AuditEntry[]) => {
  const p = purchaseSummary(m, audit);
  return p && { ...p, price: formatUsd(p.price), savings: formatUsd(p.savings) };
};

const receiptView = (m: Mandate, audit: AuditEntry[]) => {
  const r = mandateReceipt(m, audit);
  return {
    ...r,
    holdRenewed: r.holdRenewed && { ...r.holdRenewed, at: r.holdRenewed.at.toISOString() },
    amounts: {
      held: formatUsd(r.amounts.held),
      captured: formatUsd(r.amounts.captured),
      released: r.amounts.released,
      refunded: formatUsd(r.amounts.refunded),
    },
    times: {
      approved: iso(r.times.approved),
      captured: iso(r.times.captured),
      released: iso(r.times.released),
      refunded: iso(r.times.refunded),
    },
    confirmations: r.confirmations.map((c) => ({ ...c, at: c.at.toISOString() })),
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
  nextCheckAt: Date | null,
) => ({
  id: m.id,
  status: m.status,
  outcome: outcomeOf(m, now),
  kind: m.terms.kind,
  digest: m.digest,
  createdAt: m.createdAt.toISOString(),
  validUntil: m.terms.validUntil.toISOString(),
  // The latest time a check may be proposed or dragged to: the window's end or the hold's expiry.
  latestCheckAt: latestCheckAt(m).toISOString(),
  // When the watcher next looks at a watching order: the accepted extra check or the regular tick.
  nextCheckAt: outcomeOf(m, now) === "watching" ? (nextCheckAt?.toISOString() ?? null) : null,
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
