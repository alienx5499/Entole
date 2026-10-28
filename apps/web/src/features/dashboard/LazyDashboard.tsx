"use client";

import dynamic from "next/dynamic";
import { CurveLoader } from "@/shared/ui";

// Studio and AG Grid are heavy and browser-only, so the page paints first and loads them after.
export const Dashboard = dynamic(() => import("./Dashboard").then((m) => m.Dashboard), {
  ssr: false,
  loading: () => <CurveLoader title="Loading your dashboard" subtitle="Reading every order" />,
});
