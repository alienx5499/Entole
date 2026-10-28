import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "New limit order" };

export default function NewMandateLayout({ children }: { children: ReactNode }) {
  return children;
}
