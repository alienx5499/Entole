"use client";

import type { AgCartesianChartOptions, AgLineSeriesOptions } from "ag-charts-community";
import {
  LegendModule,
  LineSeriesModule,
  ModuleRegistry,
  NumberAxisModule,
  TimeAxisModule,
} from "ag-charts-community";
import { AgCharts } from "ag-charts-react";
import type { AgWidgetParams } from "ag-studio";
import { useEffect, useMemo, useState } from "react";
import s from "./dashboard.module.css";
import { CHART_COLORS, type PriceChartDef, SKETCH } from "./studio";
import { byName, tableFields } from "./widget-fields";

ModuleRegistry.registerModules([LineSeriesModule, TimeAxisModule, NumberAxisModule, LegendModule]);

const COLUMNS = ["orderId", "product", "at", "price", "limit"] as const;
type Point = { orderId: string; product: string; at: Date; price: number; limit: number };

const usd = (n: number) => `$${n.toFixed(2)}`;

/** With no order picked, the chart follows the order with the newest price point. */
function latestOrder(points: Point[]): Point[] {
  const last = points.reduce<Point | null>((a, p) => (!a || p.at > a.at ? p : a), null);
  return last ? points.filter((p) => p.orderId === last.orderId) : [];
}

function chartOptions(points: Point[]): AgCartesianChartOptions {
  // The chart draws on canvas, which cannot read CSS variables, so the app font is resolved here.
  const font = getComputedStyle(document.body).fontFamily;
  const products = [...new Set(points.map((p) => p.product))];
  const limit = points[0]?.limit ?? 0;
  const times = points.map((p) => p.at.getTime());
  const span = [new Date(Math.min(...times)), new Date(Math.max(...times))];
  const lines: AgLineSeriesOptions[] = products.map((product, i) => ({
    type: "line",
    data: points.filter((p) => p.product === product),
    xKey: "at",
    yKey: "price",
    yName: product,
    stroke: CHART_COLORS[i % CHART_COLORS.length],
    strokeWidth: 2.5,
    marker: { size: 5, fill: CHART_COLORS[i % CHART_COLORS.length] },
  }));
  return {
    background: { fill: "transparent" },
    data: [],
    series: [
      ...lines,
      {
        type: "line",
        data: span.map((at) => ({ at, limit })),
        xKey: "at",
        yKey: "limit",
        yName: `Your limit ${usd(limit)}`,
        stroke: SKETCH.RED,
        strokeWidth: 2,
        lineDash: [8, 5],
        marker: { enabled: false },
      },
    ],
    axes: {
      x: { type: "time", position: "bottom", label: { color: SKETCH.INK_SOFT } },
      y: {
        type: "number",
        position: "left",
        label: { color: SKETCH.INK_SOFT, formatter: ({ value }) => usd(Number(value)) },
      },
    },
    legend: { position: "bottom", item: { label: { fontFamily: font, color: SKETCH.INK } } },
    theme: { params: { fontFamily: font, fontSize: 13, textColor: SKETCH.INK } },
  };
}

/** Price history for the order picked in the grid, against its dashed limit line. */
export function PriceChartWidget(params: AgWidgetParams<PriceChartDef>) {
  const { widgetApi } = params;
  const [points, setPoints] = useState<Point[] | null>(null);
  const fields = useMemo(() => tableFields(widgetApi, "prices", COLUMNS), [widgetApi]);
  // More than one order in the data means nothing is picked yet.
  const [many, setMany] = useState(true);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Studio passes new params on every refresh (filters, cross filter)
  useEffect(() => {
    let live = true;
    widgetApi.setDisplayState("loading", { prominent: points === null });
    widgetApi
      .getData({ fields: Object.values(fields) })
      .then((res) => {
        if (!live) return;
        const all = byName(fields, res.results.rows).map((r) => ({
          orderId: String(r.orderId),
          product: String(r.product),
          at: new Date(r.at as string | number | Date),
          price: Number(r.price),
          limit: Number(r.limit),
        }));
        setMany(new Set(all.map((p) => p.orderId)).size > 1);
        const shown = latestOrder(all).sort((a, b) => a.at.getTime() - b.at.getTime());
        setPoints(shown);
        widgetApi.setDisplayState(shown.length > 0 ? "displayed" : "noData");
      })
      .catch(() => live && widgetApi.setDisplayState("noData"));
    return () => {
      live = false;
    };
  }, [params]);

  const options = useMemo(() => (points?.length ? chartOptions(points) : null), [points]);
  const limit = points?.[0]?.limit;

  return (
    <figure className={s.chartWidget}>
      <figcaption className={s.chartCaption}>
        <span className={s.chartTitle}>Price history</span>
        <span className={s.chartHint}>
          {many
            ? "Latest order. Pick a row in the grid to switch."
            : "Pick another row to switch, or the same one to clear."}
        </span>
      </figcaption>
      <div
        className={s.chartBody}
        role="img"
        aria-label={
          points?.length && limit !== undefined
            ? `Price history for ${new Set(points.map((p) => p.product)).size} items against a ${usd(limit)} limit, lowest seen ${usd(Math.min(...points.map((p) => p.price)))}`
            : "No price history"
        }
      >
        {options && <AgCharts options={options} />}
      </div>
    </figure>
  );
}
