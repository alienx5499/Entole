"use client";

import type { CellKeyDownEvent, ColDef, ICellRendererParams } from "ag-grid-community";
import { AllCommunityModule } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import type { AgWidgetParams } from "ag-studio";
import { studioGridTheme } from "ag-studio";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MandateOutcome } from "@/shared/api";
import s from "./dashboard.module.css";
import type { OrdersGridDef } from "./studio";
import { byName, tableFields } from "./widget-fields";

const COLUMNS = [
  "id",
  "order",
  "outcome",
  "outcomeKey",
  "limit",
  "paid",
  "saved",
  "shop",
  "createdAt",
  "validUntil",
] as const;
type Row = Record<(typeof COLUMNS)[number], unknown>;

const MODULES = [AllCommunityModule];

function OutcomeTag({ data, value }: ICellRendererParams<Row>) {
  const key = data?.outcomeKey as MandateOutcome | undefined;
  return <span className={`${s.tag} ${key ? (s[key] ?? "") : ""}`}>{String(value ?? "")}</span>;
}

/**
 * The orders as an AG Grid inside Studio. Clicking a row cross-filters the page to that order, so
 * the price chart and the KPI tiles follow it; clicking it again clears the selection.
 */
export function OrdersGridWidget(params: AgWidgetParams<OrdersGridDef>) {
  const { widgetApi } = params;
  const [rows, setRows] = useState<Row[]>([]);
  const fields = useMemo(() => tableFields(widgetApi, "orders", COLUMNS), [widgetApi]);
  const grid = useRef<AgGridReact<Row>>(null);
  // Mirrors the cross filter this grid set, for the row highlight.
  const selected = useRef<unknown>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Studio passes new params on every refresh (filters, edits)
  useEffect(() => {
    let live = true;
    widgetApi.setDisplayState("loading", { prominent: rows.length === 0 });
    // The grid lists every order; its own selection must not filter it down to one row.
    widgetApi
      .getData({ fields: Object.values(fields) }, { crossFilter: "none" })
      .then((res) => {
        if (!live) return;
        const next = byName(fields, res.results.rows);
        setRows(next);
        widgetApi.setDisplayState(next.length > 0 ? "displayed" : "noData");
      })
      .catch(() => live && widgetApi.setDisplayState("noData"));
    return () => {
      live = false;
    };
  }, [params]);

  const columnDefs = useMemo<ColDef<Row>[]>(() => {
    const fmt = (name: keyof Row) => (p: { value: unknown }) =>
      widgetApi.formatFieldValue(fields[name], p.value);
    const col = (name: keyof Row, extra: ColDef<Row> = {}): ColDef<Row> => ({
      field: name,
      headerName: fields[name].name,
      valueFormatter: fmt(name),
      ...extra,
    });
    return [
      // Order, outcome and the money columns fit the widget at laptop width; shop and dates stay one
      // column-menu click away (shops have their own chart), and a hover shows the full order name.
      col("order", { flex: 2, minWidth: 140, tooltipField: "order", valueFormatter: undefined }),
      col("outcome", { cellRenderer: OutcomeTag, minWidth: 115, valueFormatter: undefined }),
      col("limit", { type: "numericColumn", width: 80 }),
      col("paid", { type: "numericColumn", width: 80 }),
      col("saved", { type: "numericColumn", width: 80 }),
      col("shop", { minWidth: 110, hide: true, valueFormatter: undefined }),
      col("createdAt", { width: 120, sort: "desc", hide: true }),
      col("validUntil", { width: 120, hide: true }),
    ];
  }, [fields, widgetApi]);

  const select = (row: Row | undefined) => {
    if (!row) return;
    selected.current = selected.current === row.id ? null : row.id;
    grid.current?.api.redrawRows();
    widgetApi.toggleCrossFilter({
      type: "value",
      field: fields.id,
      value: row.id,
      group: 0,
      reset: true,
    });
  };
  // Enter or Space on a focused cell selects too, so the cross filter works from the keyboard.
  const onCellKeyDown = (e: CellKeyDownEvent<Row>) => {
    const key = (e.event as KeyboardEvent | null | undefined)?.key;
    if (key === "Enter" || key === " ") select(e.data);
  };

  return (
    <section className={s.gridWidget} aria-label="Your limit orders">
      <AgGridReact<Row>
        ref={grid}
        modules={MODULES}
        theme={studioGridTheme}
        rowData={rows}
        columnDefs={columnDefs}
        defaultColDef={{ sortable: true, filter: true, resizable: true }}
        getRowId={(p) => String(p.data.id)}
        rowClassRules={{ [s.selectedRow ?? "selected"]: (p) => p.data?.id === selected.current }}
        onCellClicked={(e) => select(e.data)}
        onCellKeyDown={onCellKeyDown}
        overlayNoRowsTemplate="No limit orders yet"
      />
    </section>
  );
}
