import type { RejectedView } from "@/shared/api";
import s from "./RejectedList.module.css";

/** Items the shortlist turned down: the title struck through in red pen, then the reasons. */
export function RejectedList({ rejected }: { rejected: RejectedView[] }) {
  return (
    <ul className={s.list}>
      {rejected.map((r) => (
        // Titles repeat across products, so the shop and reasons make the key unique.
        <li key={`${r.merchant}|${r.title}|${r.details.join(";")}`}>
          <span className="pen-strike">{r.title}</span>{" "}
          <span className={s.merchant}>{r.merchant}</span>
          {r.details.length > 0 && <span className={s.reason}>: {r.details.join("; ")}</span>}
        </li>
      ))}
    </ul>
  );
}
