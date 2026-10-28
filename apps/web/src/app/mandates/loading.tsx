import { CurveLoader } from "@/shared/ui";

// Shown while a /mandates page and its code load, so navigation never lands on a blank screen.
export default function Loading() {
  return <CurveLoader title="Loading" />;
}
