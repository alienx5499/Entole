import type { RejectedView } from "@/shared/api";
import { RejectedList } from "@/shared/ui";
import s from "./review.module.css";

const isPlanted = (r: RejectedView) => r.details.some((d) => /planted demo listing/i.test(d));

/** One line, collapsed by default; opening it shows the struck-through items and reasons. */
export function RejectedSummary({ rejected }: { rejected: RejectedView[] }) {
  if (rejected.length === 0) return null;
  const n = rejected.length;
  const planted = rejected.some(isPlanted);
  const note = planted
    ? n === 1
      ? " (planted demo listing)"
      : " (one is the planted demo listing)"
    : "";
  return (
    <details className={s.rejected}>
      <summary>
        {n} {n === 1 ? "item" : "items"} rejected{note}. <span className={s.why}>Show why</span>
      </summary>
      <RejectedList rejected={rejected} />
    </details>
  );
}
