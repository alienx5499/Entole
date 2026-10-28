import { CurveLoader } from "@/shared/ui";

// Shown while the dashboard's code loads; AG Studio is a large bundle.
export default function Loading() {
  return <CurveLoader title="Loading your dashboard" />;
}
