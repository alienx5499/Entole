"use client";

import {
  type AgPanelConfig,
  AgStudioAiModule,
  type AgStudioMode,
  type AgViewModePanelType,
  type AgWidgetsConfig,
} from "ag-studio";
import { AgStudio, AgStudioProvider, createWidgets } from "ag-studio-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CurveLoader } from "@/shared/ui";
import s from "./dashboard.module.css";
import { type DashboardData, loadDashboard } from "./load";
import { OrdersGridWidget } from "./OrdersGridWidget";
import { PriceChartWidget } from "./PriceChartWidget";
import { savingsAgent } from "./savings-agent";
import {
  buildData,
  ENTOLE_MENU,
  type EntoleRegistry,
  initialReport,
  ordersGridWidget,
  priceChartWidget,
  sketchTheme,
} from "./studio";

// Without a key Studio still runs, with a watermark and a console notice.
const LICENSE_KEY = process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY || undefined;
const MODULES = [AgStudioAiModule];

// The AI panel also sits in view mode, so a shopper can ask without opening the editor. Studio's
// types list only `filters` for view mode, but its panel service places any panel id it is given.
const PANELS: AgPanelConfig = {
  view: { left: ["ai" as AgViewModePanelType], right: ["filters"] },
  edit: { left: ["ai"], right: ["filters", "edit", "data"] },
};

// A function, so Studio hands in its default menu (minus widgets this data engine cannot run) and
// the Entole group goes on top of it.
const widgets = (defaults: AgWidgetsConfig) =>
  createWidgets<EntoleRegistry>({
    additionalTypes: [
      { ...ordersGridWidget, comp: OrdersGridWidget },
      { ...priceChartWidget, comp: PriceChartWidget },
    ],
    menu: [ENTOLE_MENU, ...defaults.menu],
  });

/** The signed-in shopper's orders as an AG Studio report they can rearrange and ask about. */
export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [failed, setFailed] = useState(false);
  const [mode, setMode] = useState<AgStudioMode>("view");

  // A 401 sends the browser to `/?login=1` inside the client.
  useEffect(() => {
    loadDashboard()
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  const studioData = useMemo(() => (data ? buildData(data) : undefined), [data]);
  // Studio reads `ai` once, when it is created.
  const ai = useMemo(() => (data ? savingsAgent(data.orders) : undefined), [data]);

  if (failed) return <p role="alert">Could not load your dashboard. Reload to retry.</p>;
  if (!data) return <CurveLoader title="Loading your dashboard" subtitle="Reading every order" />;

  return (
    <section className={s.wrap} aria-labelledby="dashboard-title">
      <div className={s.head}>
        <h1 id="dashboard-title">Your dashboard</h1>
        {data.orders.length > 0 && (
          <button
            type="button"
            className="btn"
            aria-pressed={mode === "edit"}
            onClick={() => setMode((m) => (m === "edit" ? "view" : "edit"))}
          >
            {mode === "edit" ? "Done editing" : "Edit layout"}
          </button>
        )}
      </div>
      {data.orders.length === 0 ? (
        <p className="card">
          No limit orders yet. <Link href="/mandates/new">Set a price</Link> and your dashboard
          fills in as Entole watches it.
        </p>
      ) : (
        <div className={s.canvas}>
          <AgStudioProvider licenseKey={LICENSE_KEY} modules={MODULES}>
            <AgStudio<EntoleRegistry>
              style={{ height: "100%", width: "100%" }}
              theme={sketchTheme}
              layout={{ widgetBorderEnabled: true }}
              data={studioData}
              widgets={widgets}
              ai={ai}
              panels={PANELS}
              initialState={initialReport}
              mode={mode}
            />
          </AgStudioProvider>
        </div>
      )}
    </section>
  );
}
