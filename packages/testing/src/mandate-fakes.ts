import type {
  AuditEntry,
  Mandate,
  MandateRepository,
  PaymentGateway,
  ProductSearch,
  ProductSummary,
  ResolvedOffer,
} from "@entole/mandate";
import type { Money } from "@entole/shared-kernel";

type OrderCall = Parameters<PaymentGateway["createAuthorizationOrder"]>[0] & { orderId: string };
type CaptureCall = Parameters<PaymentGateway["capture"]>[0];

export class FakePaymentGateway implements PaymentGateway {
  orders: OrderCall[] = [];
  captures: CaptureCall[] = [];
  voids: string[] = [];
  refunds: Parameters<PaymentGateway["refundCapture"]>[0][] = [];
  overrideCustomId?: string;
  authorizationExpiresAt = new Date("2026-11-30T00:00:00Z");
  private captureFailures = 0;
  private voidFailures = 0;

  failNextCapture(): void {
    this.captureFailures++;
  }
  failNextVoid(): void {
    this.voidFailures++;
  }

  async createAuthorizationOrder(i: Parameters<PaymentGateway["createAuthorizationOrder"]>[0]) {
    const orderId = `order-${this.orders.length + 1}`;
    this.orders.push({ ...i, orderId });
    return { orderId, approveUrl: `https://paypal.test/approve/${orderId}` };
  }

  async authorizeOrder(orderId: string) {
    const order = this.orders.find((o) => o.orderId === orderId);
    if (!order) throw new Error(`Unknown order ${orderId}`);
    return {
      authorizationId: `auth-${orderId}`,
      amount: order.amount,
      expiresAt: this.authorizationExpiresAt,
      customId: this.overrideCustomId ?? order.customId,
    };
  }

  async capture(i: CaptureCall) {
    if (this.captureFailures > 0) {
      this.captureFailures--;
      throw new Error("PayPal capture failed");
    }
    this.captures.push(i);
    return { captureId: `cap-${this.captures.length}` };
  }

  async refundCapture(i: Parameters<PaymentGateway["refundCapture"]>[0]) {
    this.refunds.push(i);
    return { refundId: `ref-${this.refunds.length}` };
  }

  async voidAuthorization(authorizationId: string) {
    if (this.voidFailures > 0) {
      this.voidFailures--;
      throw new Error("PayPal void failed");
    }
    this.voids.push(authorizationId);
  }
}

export class FakeProductSearch implements ProductSearch {
  constructor(
    private readonly summaries: ProductSummary[] = [],
    private readonly offers: ResolvedOffer[] = [],
  ) {}

  async search(q: { query: string; maxPrice?: Money; limit: number }) {
    return this.summaries.slice(0, q.limit);
  }

  async resolveOffer(i: { productId: string; merchant: string; options: Record<string, string> }) {
    return (
      this.offers.find(
        (o) => o.productId === i.productId && o.merchant.toLowerCase() === i.merchant.toLowerCase(),
      ) ?? null
    );
  }
}

export class InMemoryMandateRepository implements MandateRepository {
  private readonly mandates = new Map<string, Mandate>();
  private readonly orders = new Map<string, string>();
  private readonly approveUrls = new Map<string, string>();
  private readonly audits = new Map<string, AuditEntry[]>();
  private readonly webhookEvents = new Set<string>();

  async save(m: Mandate) {
    this.mandates.set(m.id, m);
  }
  async get(id: string) {
    return this.mandates.get(id) ?? null;
  }
  async findByOrderId(orderId: string) {
    const id = this.orders.get(orderId);
    return id ? (this.mandates.get(id) ?? null) : null;
  }
  async linkOrder(mandateId: string, orderId: string, approveUrl: string) {
    this.orders.set(orderId, mandateId);
    this.approveUrls.set(mandateId, approveUrl);
  }
  async approveUrlFor(mandateId: string) {
    return this.approveUrls.get(mandateId) ?? null;
  }
  async appendAudit(mandateId: string, e: AuditEntry) {
    this.audits.set(mandateId, [...(this.audits.get(mandateId) ?? []), e]);
  }
  async listAudit(mandateId: string) {
    return [...(this.audits.get(mandateId) ?? [])];
  }
  async listFundedLimit() {
    return [...this.mandates.values()].filter(
      (m) => (m.status === "funded" || m.status === "exhausted") && m.terms.kind === "limit",
    );
  }
  async listByOwner(ownerId: string) {
    return [...this.mandates.values()]
      .filter((m) => m.ownerId === ownerId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  async countCreatedSince(since: Date, ownerId?: string) {
    return [...this.mandates.values()].filter(
      (m) => m.createdAt >= since && (ownerId === undefined || m.ownerId === ownerId),
    ).length;
  }
  async claimWebhookEvent(eventId: string) {
    if (this.webhookEvents.has(eventId)) return false;
    this.webhookEvents.add(eventId);
    return true;
  }
  async releaseWebhookEvent(eventId: string) {
    this.webhookEvents.delete(eventId);
  }
}
