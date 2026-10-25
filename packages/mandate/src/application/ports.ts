import type { Money } from "@entole/shared-kernel";
import type { AuditEntry, Mandate, ResolvedOffer } from "../domain/index.ts";

export interface PaymentGateway {
  createAuthorizationOrder(i: {
    mandateId: string;
    amount: Money;
    customId: string;
    description: string;
    returnUrl: string;
    cancelUrl: string;
  }): Promise<{ orderId: string; approveUrl: string }>;
  authorizeOrder(
    orderId: string,
  ): Promise<{ authorizationId: string; amount: Money; expiresAt: Date; customId: string }>;
  capture(i: {
    authorizationId: string;
    amount: Money;
    idempotencyKey: string;
    invoiceId: string;
  }): Promise<{ captureId: string }>;
  voidAuthorization(authorizationId: string): Promise<void>;
  // Full refund of one capture. The idempotency key makes a retry return the same refund.
  refundCapture(i: { captureId: string; idempotencyKey: string }): Promise<{ refundId: string }>;
}

// Asks PayPal whether a webhook delivery is genuine. `body` is the raw request body, unparsed.
export interface WebhookVerifier {
  verify(headers: Headers, body: string): Promise<boolean>;
}

export type ProductSummary = {
  productId: string;
  title: string;
  offers: { merchant: string; price: Money }[];
  options: Record<string, string[]>;
  description: string;
};

// The catalog. Owned here because a capture re-quotes through resolveOffer; shopping and
// limit-order use the same port.
export interface ProductSearch {
  search(q: { query: string; maxPrice?: Money; limit: number }): Promise<ProductSummary[]>;
  resolveOffer(i: {
    productId: string;
    merchant: string;
    options: Record<string, string>;
  }): Promise<ResolvedOffer | null>;
}

// Runs fn while no other caller, in this process or another, runs work for the same mandate.
// Every writer of a mandate (API routes, the watcher, the workflow worker) must share one.
export interface MandateLock {
  run<T>(mandateId: string, fn: () => Promise<T>): Promise<T>;
}

export interface MandateRepository {
  save(m: Mandate): Promise<void>;
  get(id: string): Promise<Mandate | null>;
  findByOrderId(orderId: string): Promise<Mandate | null>;
  // The approve link travels with the order id so the review page can reopen PayPal after a reload.
  linkOrder(mandateId: string, orderId: string, approveUrl: string): Promise<void>;
  approveUrlFor(mandateId: string): Promise<string | null>;
  appendAudit(mandateId: string, e: AuditEntry): Promise<void>;
  listAudit(mandateId: string): Promise<AuditEntry[]>;
  // Limit mandates still holding money: funded, or exhausted (captured) but not yet closed.
  listFundedLimit(): Promise<Mandate[]>;
  // Newest first.
  listByOwner(ownerId: string): Promise<Mandate[]>;
  // Mandates created at or after `since`, for one owner or for everyone. Feeds the daily create caps.
  countCreatedSince(since: Date, ownerId?: string): Promise<number>;
  // PayPal webhook event ids. claim is false when the id was already claimed; release undoes a
  // claim whose handling failed, so PayPal's retry is processed.
  claimWebhookEvent(eventId: string): Promise<boolean>;
  releaseWebhookEvent(eventId: string): Promise<void>;
}
