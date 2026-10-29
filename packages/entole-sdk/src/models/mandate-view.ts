import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { auditEntrySchema, type AuditEntry } from "./audit-entry.js";
import { candidateSchema, type Candidate } from "./candidate.js";
import { mandateKindSchema, type MandateKind } from "./mandate-kind.js";
import { mandateOutcomeSchema, type MandateOutcome } from "./mandate-outcome.js";
import { mandateStatusSchema, type MandateStatus } from "./mandate-status.js";
import { mandateTermsSchema, type MandateTerms } from "./mandate-terms.js";
import { purchaseSchema, type Purchase } from "./purchase.js";
import { receiptSchema, type Receipt } from "./receipt.js";
import { rejectedSchema, type Rejected } from "./rejected.js";

/** The full view of one limit order. */
export type MandateView = {
  /** The limit order id, `mandate_` followed by a UUID. */
  id: string;
  /** Where the order is in its PayPal payment lifecycle. */
  status: MandateStatus;
  /** What happened to the order, in words for people; `status` stays the payment lifecycle. */
  outcome: MandateOutcome;
  /** The order type; orders created through this API are always `limit`. */
  kind: MandateKind;
  /** SHA-256 of the signed terms, hex. */
  digest: string;
  /** When the order was drafted. */
  createdAt: Date;
  /** When the order stops watching prices. */
  validUntil: Date;
  /** The signed terms; their SHA-256 is the order's `digest`. */
  terms: MandateTerms;
  /** The signed shortlist the watcher may buy from. */
  candidates: Candidate[];
  /** Items the shortlist turned down at create time; not part of the digest. */
  rejected: Rejected[];
  /** The PayPal approve link while `awaiting_approval`, else null. */
  approveUrl: string | null;
  /** A USD amount as a decimal string with two places. */
  held: string;
  /** A USD amount as a decimal string with two places. */
  captured: string;
  /** A USD amount as a decimal string with two places. */
  remaining: string;
  /** True once PayPal released what was left of the hold. */
  voided: boolean;
  /** The PayPal authorization (hold) id; null before approval. */
  authorizationId: string | null;
  /** True when a labelled fake listing was planted for the prompt-injection demo. */
  demoInjection: boolean;
  /** True when the order buys at recorded history prices; part of the digest. */
  replay: boolean;
  /** The one purchase the watcher captured; null until it bought. */
  purchase: Purchase | null;
  /** Everything PayPal-side for the order, from the order and its audit trail. */
  receipt: Receipt;
  /** The audit trail, oldest first. */
  audit: AuditEntry[];
  /** Always true; Entole runs on the PayPal sandbox only, so the order moves no real money. */
  sandbox: boolean;
};

export const mandateViewSchema: Schema<MandateView> = s.object<MandateView>({
  id: s.string(),
  status: mandateStatusSchema,
  outcome: mandateOutcomeSchema,
  kind: mandateKindSchema,
  digest: s.string(),
  createdAt: s.dateTime(),
  validUntil: s.dateTime(),
  terms: mandateTermsSchema,
  candidates: s.array(s.lazy(() => candidateSchema)),
  rejected: s.array(s.lazy(() => rejectedSchema)),
  approveUrl: s.nullable(s.string()),
  held: s.string(),
  captured: s.string(),
  remaining: s.string(),
  voided: s.boolean(),
  authorizationId: s.nullable(s.string()),
  demoInjection: s.boolean(),
  replay: s.boolean(),
  purchase: s.nullable(s.lazy(() => purchaseSchema)),
  receipt: receiptSchema,
  audit: s.array(s.lazy(() => auditEntrySchema)),
  sandbox: s.boolean(),
});
