import type { AuditView } from "@/shared/api";
import s from "./Timeline.module.css";

function cls(e: AuditView): string {
  switch (e.kind) {
    case "proposal_allowed":
      return "highlight";
    case "proposal_blocked":
      return "pen-strike";
    case "agent_step":
      return "note-blue";
    case "capture_failed":
      return s.failed ?? "";
    default:
      return "";
  }
}

const hms = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour12: false });

export function Timeline({ audit }: { audit: AuditView[] }) {
  const items = [...audit].reverse();
  return (
    <section className={`card ${s.panel}`}>
      <h3 className={s.title}>Timeline</h3>
      <ul className={s.list} aria-live="polite">
        {items.map((e) => (
          <li key={`${e.at}-${e.kind}-${e.message}`} className={cls(e)}>
            <span className="mono">{hms(e.at)}</span> {e.message}
            {e.kind === "proposal_allowed" && e.data?.captureId && (
              <>
                {" "}
                <span className="mono">{e.data.captureId}</span>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
