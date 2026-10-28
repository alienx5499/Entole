import { CurveLoader } from "@/shared/ui";

// Shown while the schedule's code loads; Bryntum Scheduler is a large bundle.
export default function Loading() {
  return <CurveLoader title="Loading your schedule" />;
}
