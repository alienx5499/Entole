import type { SQL } from "bun";
import type { MandateRepository } from "../../application/ports.ts";
import type { AuditEntry, Mandate } from "../../domain/index.ts";
import { mandateFromJson, mandateToJson } from "./mandate-codec.ts";

// Bun returns jsonb as parsed values, but accept a string too.
const parse = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);
const toMandate = (r: { data: unknown } | undefined): Mandate | null =>
  r ? mandateFromJson(parse(r.data) as Parameters<typeof mandateFromJson>[0]) : null;

type AuditRow = { at: Date; kind: AuditEntry["kind"]; message: string; data: unknown };
const toAudit = (r: AuditRow): AuditEntry => ({
  at: new Date(r.at),
  kind: r.kind,
  message: r.message,
  ...(r.data ? { data: parse(r.data) as Record<string, string> } : {}),
});

export class PostgresMandateRepository implements MandateRepository {
  constructor(private readonly sql: SQL) {}

  async save(m: Mandate) {
    const data = JSON.stringify(mandateToJson(m));
    await this.sql`
      insert into mandates (id, owner_id, status, data, updated_at)
      values (${m.id}, ${m.ownerId}, ${m.status}, ${data}::text::jsonb, now())
      on conflict (id) do update
        set owner_id = excluded.owner_id, status = excluded.status,
            data = excluded.data, updated_at = now()`;
  }

  async get(id: string) {
    const [r] = await this.sql`select data from mandates where id = ${id}`;
    return toMandate(r);
  }

  async findByOrderId(orderId: string) {
    const [r] = await this.sql`select data from mandates where order_id = ${orderId}`;
    return toMandate(r);
  }

  async linkOrder(mandateId: string, orderId: string, approveUrl: string) {
    const rows = await this.sql`
      update mandates set order_id = ${orderId}, approve_url = ${approveUrl}, updated_at = now()
      where id = ${mandateId} returning id`;
    if (rows.length === 0) throw new Error(`Cannot link order: unknown mandate ${mandateId}`);
  }

  async approveUrlFor(mandateId: string) {
    const [r] = await this.sql`select approve_url from mandates where id = ${mandateId}`;
    return (r?.approve_url as string | null | undefined) ?? null;
  }

  async appendAudit(mandateId: string, e: AuditEntry) {
    const data = e.data ? JSON.stringify(e.data) : null;
    await this.sql`
      insert into audit (mandate_id, at, kind, message, data)
      values (${mandateId}, ${e.at}, ${e.kind}, ${e.message}, ${data}::text::jsonb)`;
  }

  async listAudit(mandateId: string) {
    const rows = await this.sql`
      select at, kind, message, data from audit where mandate_id = ${mandateId} order by id`;
    return rows.map(toAudit);
  }

  async listAuditFor(mandateIds: string[]) {
    const byId = new Map<string, AuditEntry[]>(mandateIds.map((id) => [id, []]));
    if (mandateIds.length === 0) return byId;
    const rows = await this.sql`
      select mandate_id, at, kind, message, data from audit
      where mandate_id = any(${this.sql.array(mandateIds, "TEXT")}) order by id`;
    for (const r of rows as (AuditRow & { mandate_id: string })[])
      byId.get(r.mandate_id)?.push(toAudit(r));
    return byId;
  }

  async lastBlocked(mandateId: string, productId: string, merchant: string) {
    const [r] = await this.sql`
      select at, kind, message, data from audit
      where mandate_id = ${mandateId} and kind = 'proposal_blocked'
        and data->>'productId' = ${productId} and data->>'merchant' = ${merchant}
      order by id desc limit 1`;
    return r ? toAudit(r as AuditRow) : null;
  }

  // Served by audit_mandate_idx; only the few note rows come back, never a whole audit trail.
  async recentNotes(mandateIds: string[], since: Date) {
    const byId = new Map<string, AuditEntry[]>(mandateIds.map((id) => [id, []]));
    if (mandateIds.length === 0) return byId;
    const rows = await this.sql`
      select mandate_id, at, kind, message, data from audit
      where mandate_id = any(${this.sql.array(mandateIds, "TEXT")})
        and kind = 'channel3_noted' and at > ${since}
      order by id`;
    for (const r of rows as (AuditRow & { mandate_id: string })[])
      byId.get(r.mandate_id)?.push(toAudit(r));
    return byId;
  }

  async listFundedLimit(): Promise<Mandate[]> {
    const rows = await this.sql`
      select data from mandates
      where status in ('funded', 'exhausted') and data->'terms'->>'kind' = 'limit'
      order by updated_at`;
    return rows.map((r: { data: unknown }) => toMandate(r) as Mandate);
  }

  // Served by mandates_funded_candidates_idx, so a webhook never scans every limit order.
  async listFundedLimitForProduct(productId: string): Promise<Mandate[]> {
    const rows = await this.sql`
      select data from mandates
      where status = 'funded' and data->'terms'->>'kind' = 'limit'
        and data->'terms'->'candidates'
          @> jsonb_build_array(jsonb_build_object('productId', ${productId}::text))
      order by updated_at`;
    return rows.map((r: { data: unknown }) => toMandate(r) as Mandate);
  }

  async listByOwner(ownerId: string): Promise<Mandate[]> {
    const rows = await this.sql`
      select data from mandates
      where owner_id = ${ownerId}
      order by data->>'createdAt' desc`;
    return rows.map((r: { data: unknown }) => toMandate(r) as Mandate);
  }

  async countCreatedSince(since: Date, ownerId?: string): Promise<number> {
    const [r] = ownerId
      ? await this.sql`
          select count(*)::int as n from mandates
          where owner_id = ${ownerId} and (data->>'createdAt')::timestamptz >= ${since}`
      : await this.sql`
          select count(*)::int as n from mandates
          where (data->>'createdAt')::timestamptz >= ${since}`;
    return Number(r?.n ?? 0);
  }

  async claimWebhookEvent(eventId: string) {
    const rows = await this.sql`
      insert into webhook_events (id) values (${eventId}) on conflict (id) do nothing returning id`;
    return rows.length > 0;
  }

  async releaseWebhookEvent(eventId: string) {
    await this.sql`delete from webhook_events where id = ${eventId}`;
  }
}
