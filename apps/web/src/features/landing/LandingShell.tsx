import type { ReactNode } from "react";
import s from "./landing.module.css";

/** Wider main column for the marketing page; the app pages keep the narrow one. */
export function LandingShell({ children }: { children: ReactNode }) {
  return <main className={s.shell}>{children}</main>;
}
