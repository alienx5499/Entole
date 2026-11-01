// The report the dashboard opens on.

import type { AgReportState, AgWidgetLayoutState } from "ag-studio";
import { HEADING, SKETCH } from "./studio-theme";
import type { EntoleRegistry } from "./studio-widgets";

const { INK, NAVY, YELLOW, CARD, BODY, MONO } = SKETCH;

// Canvas tracks: 24 columns wide, rows of studioCanvasRowHeight.
const at = (xTrack: number, yTrack: number, xSpan: number, ySpan: number): AgWidgetLayoutState => ({
  xTrack,
  yTrack,
  xSpan,
  ySpan,
});
const title = (text: string) => ({ title: { enabled: true, text } });
const sum = (id: string) => ({ id, aggregation: "sum" as const });
const countd = (id: string) => ({ id, aggregation: "countd" as const });

const typography = (fontFamily: string, fontSize: number) => ({
  fontFamily,
  fontSize,
  fontWeight: "normal" as const,
  fontStyle: "normal" as const,
});

const kpi = (text: string, field: string, note = "") => ({
  type: "value" as const,
  dataMapping: { value: [sum(field)] },
  format: {
    title: { enabled: true, text, typography: typography(HEADING, 20) },
    caption: { enabled: true, text: note, typography: typography(BODY, note ? 13 : 0) },
    style: { typography: typography(MONO, 26) },
  },
});

export const initialReport: AgReportState<EntoleRegistry> = {
  selectedPageId: "overview",
  // The AI panel opens from its edge tab, so the report keeps its full width until asked.
  panels: { filters: { collapsed: true }, ai: { collapsed: true } },
  pages: [
    {
      id: "overview",
      widgets: {
        "kpi-held": kpi("Held now", "orders.heldNow"),
        "kpi-spent": kpi("Spent", "orders.spent"),
        // Savings count kept purchases only: a refunded order saved nothing.
        "kpi-saved": kpi("Saved", "orders.saved", "vs list price, kept orders"),
        "kpi-bought": kpi("Bought", "orders.isBought"),
        "kpi-released": kpi("Released", "orders.isReleased"),
        outcome: {
          type: "button-filter",
          dataMapping: { value: [{ id: "orders.outcome" }] },
          // No widget title (off by default); the "Filter by" line is hidden in dashboard.module.css.
          // Studio leaves unset item colours transparent, so the selected state needs its own fill.
          format: {
            style: {
              dimensions: { height: 32, minWidth: 128 },
              defaultItem: {
                typography: typography(BODY, 15),
                color: INK,
                backgroundColor: CARD,
                textAlign: "center",
                borderEnabled: true,
                borderWidth: 2,
                borderRadius: 10,
                borderColor: INK,
              },
              activeItem: { color: NAVY, backgroundColor: YELLOW },
            },
          },
        },
        orders: { type: "orders-grid", dataMapping: {} },
        "price-history": { type: "price-chart", dataMapping: {} },
        "by-outcome": {
          type: "donut-chart",
          dataMapping: { categoryKey: [{ id: "orders.outcome" }], valueKey: [countd("orders.id")] },
          format: {
            ...title("Orders by outcome"),
            style: { custom: { pieDataLabel: { enabled: true }, totalLabel: { enabled: true } } },
          },
        },
        "saved-by-shop": {
          type: "bar-chart-grouped",
          dataMapping: {
            categoryKey: [{ id: "purchases.shop" }],
            valueKey: [sum("purchases.saved"), sum("purchases.spent")],
          },
          format: {
            ...title("Saved and spent by shop"),
            style: { theme: { common: { legend: { enabled: true } } } },
          },
        },
      },
      widgetLayout: {
        "kpi-held": at(0, 0, 6, 7),
        "kpi-spent": at(6, 0, 6, 7),
        "kpi-saved": at(12, 0, 6, 7),
        "kpi-bought": at(18, 0, 3, 7),
        "kpi-released": at(21, 0, 3, 7),
        // Its own full-width row, so every outcome button has room for its whole label.
        outcome: at(0, 7, 24, 4),
        orders: at(0, 11, 14, 22),
        "price-history": at(14, 11, 10, 22),
        "by-outcome": at(0, 33, 9, 17),
        "saved-by-shop": at(9, 33, 15, 17),
      },
    },
  ],
};
