import { DAY_MS, MAX_LIMIT_CENTS, MAX_LIMIT_WINDOW_MS, MIN_LIMIT_CENTS } from "@entole/mandate";
import { type Money, parseUsd } from "@entole/shared-kernel";
import { HttpError } from "./http.ts";

export type CreateMandateRequest = {
  query: string;
  brands: string[];
  avoid: string[];
  requiredAttributes: Record<string, string>;
  limit: Money;
  validDays: number;
  demoInjection: boolean;
  replay: boolean;
};

const MAX_LIST = 10;
const MAX_TEXT = 200;

const invalid = (field: string): never => {
  throw new HttpError(400, "invalid_field", { field });
};

const text = (v: unknown, field: string, max = MAX_TEXT): string => {
  if (typeof v !== "string") return invalid(field);
  const s = v.trim();
  if (s === "" || s.length > max) return invalid(field);
  return s;
};

const textList = (v: unknown, field: string): string[] => {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > MAX_LIST) return invalid(field);
  return v.map((x) => text(x, field, 60));
};

const flag = (v: unknown, field: string): boolean => {
  if (v === undefined) return false;
  if (typeof v !== "boolean") return invalid(field);
  return v;
};

const attributes = (v: unknown, field: string): Record<string, string> => {
  if (v === undefined) return {};
  if (typeof v !== "object" || v === null || Array.isArray(v)) return invalid(field);
  const entries = Object.entries(v);
  if (entries.length > MAX_LIST) return invalid(field);
  return Object.fromEntries(entries.map(([k, x]) => [text(k, field, 60), text(x, field, 60)]));
};

const limitPrice = (v: unknown): Money => {
  if (typeof v !== "string" || !/^\d{1,7}(\.\d{1,2})?$/.test(v.trim()))
    return invalid("limitPrice");
  const m = parseUsd(v);
  if (m.cents < MIN_LIMIT_CENTS || m.cents > MAX_LIMIT_CENTS) return invalid("limitPrice");
  return m;
};

const MAX_VALID_DAYS = MAX_LIMIT_WINDOW_MS / DAY_MS;
const validDays = (v: unknown): number => {
  if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > MAX_VALID_DAYS)
    return invalid("validDays");
  return v as number;
};

export const parseCreateMandate = (body: unknown): CreateMandateRequest => {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return invalid("body");
  const b = body as Record<string, unknown>;
  return {
    query: text(b.query, "query"),
    brands: textList(b.brands, "brands"),
    avoid: textList(b.avoid, "avoid"),
    requiredAttributes: attributes(b.requiredAttributes, "requiredAttributes"),
    limit: limitPrice(b.limitPrice),
    validDays: validDays(b.validDays),
    demoInjection: flag(b.demoInjection, "demoInjection"),
    replay: flag(b.replay, "replay"),
  };
};

export const readJson = async (req: Request): Promise<unknown> => {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "invalid_json");
  }
};
