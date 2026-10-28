import type { AgWidgetApi } from "ag-studio";

type WidgetField = ReturnType<AgWidgetApi["getSchema"]>[number]["fields"][number];

/** A table's fields by their own name ('saved', not 'orders.saved'), read from Studio's schema. */
export function tableFields<N extends string>(
  api: AgWidgetApi,
  tableId: string,
  names: readonly N[],
) {
  const table = api.getSchema().find((t) => t.id === tableId);
  const byName = new Map(table?.fields.map((f) => [String(f.fieldId).split(".").pop(), f]));
  const picked = names.map((n) => byName.get(n));
  if (picked.some((f) => !f)) throw new Error(`Studio schema is missing fields on ${tableId}`);
  return Object.fromEntries(names.map((n, i) => [n, picked[i]])) as Record<N, WidgetField>;
}

/** Studio rows are keyed by field key; this re-keys them by field name. */
export function byName<N extends string>(
  fields: Record<N, WidgetField>,
  rows: Record<string, unknown>[],
): Record<N, unknown>[] {
  const entries = Object.entries(fields) as [N, WidgetField][];
  return rows.map(
    (row) => Object.fromEntries(entries.map(([n, f]) => [n, row[f.key]])) as Record<N, unknown>,
  );
}
