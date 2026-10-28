import type { RejectedView } from "@/shared/api";
import s from "./RejectedList.module.css";

/** Items the shortlist turned down: the title struck through in red pen, then the reasons. */
export function RejectedList({ rejected }: { rejected: RejectedView[] }) {
  return (
    <ul className={s.list}>
      {rejected.map((r, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed list, never reordered; titles repeat across products
        <li key={i}>
          <span className="pen-strike">{r.title}</span>{" "}
          <span className={s.merchant}>{r.merchant}</span>
          {r.details.length > 0 && <span className={s.reason}>: {r.details.join("; ")}</span>}
        </li>
      ))}
    </ul>
  );
}
