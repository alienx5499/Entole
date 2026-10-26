import { type Money, usd } from "@entole/shared-kernel";
import type { Mandate, ShipTo } from "../../domain/index.ts";

type MoneyJson = { cents: number };
type MandateJson = {
  id: string;
  ownerId: string;
  createdAt: string;
  terms: Omit<Mandate["terms"], "candidates" | "maxUnitPrice" | "budget" | "validUntil"> & {
    candidates: (Omit<Mandate["terms"]["candidates"][number], "baselinePrice"> & {
      baselinePrice: MoneyJson;
    })[];
    maxUnitPrice: MoneyJson;
    budget: MoneyJson;
    validUntil: string;
  };
  digest: string;
  status: Mandate["status"];
  authorization?: { id: string; amount: MoneyJson; expiresAt: string };
  captured: MoneyJson;
  voided: boolean;
  demoInjection: boolean;
  replay?: boolean; // absent on rows written before the field existed
  rejected?: Mandate["rejected"]; // same
  // Candidates written before shops were compared have no `merchants`; shopsOf reads that as one shop.
  voidAttempts?: number;
  refund?: { id: string; amount: MoneyJson }; // absent until refunded
  shipTo?: ShipTo;
};

const money = (m: Money): MoneyJson => ({ cents: m.cents });

export const mandateToJson = (m: Mandate): MandateJson => ({
  ...m,
  createdAt: m.createdAt.toISOString(),
  terms: {
    ...m.terms,
    candidates: m.terms.candidates.map((c) => ({ ...c, baselinePrice: money(c.baselinePrice) })),
    maxUnitPrice: money(m.terms.maxUnitPrice),
    budget: money(m.terms.budget),
    validUntil: m.terms.validUntil.toISOString(),
  },
  authorization: m.authorization && {
    id: m.authorization.id,
    amount: money(m.authorization.amount),
    expiresAt: m.authorization.expiresAt.toISOString(),
  },
  captured: money(m.captured),
  refund: m.refund && { id: m.refund.id, amount: money(m.refund.amount) },
  shipTo: m.shipTo,
});

export const mandateFromJson = (j: MandateJson): Mandate => ({
  ...j,
  createdAt: new Date(j.createdAt),
  terms: {
    ...j.terms,
    candidates: j.terms.candidates.map((c) => ({
      ...c,
      baselinePrice: usd(c.baselinePrice.cents),
    })),
    maxUnitPrice: usd(j.terms.maxUnitPrice.cents),
    budget: usd(j.terms.budget.cents),
    validUntil: new Date(j.terms.validUntil),
  },
  authorization: j.authorization && {
    id: j.authorization.id,
    amount: usd(j.authorization.amount.cents),
    expiresAt: new Date(j.authorization.expiresAt),
  },
  captured: usd(j.captured.cents),
  refund: j.refund && { id: j.refund.id, amount: usd(j.refund.amount.cents) },
  ...(j.shipTo ? { shipTo: j.shipTo } : {}),
  replay: j.replay ?? false,
  rejected: j.rejected ?? [],
});
