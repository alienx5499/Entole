import type { MandateOutcome } from "@/shared/api";

export const OUTCOME_LABEL: Record<MandateOutcome, string> = {
  needs_approval: "Needs approval",
  expired: "Expired",
  watching: "Watching",
  bought: "Bought",
  refunded: "Refunded",
  released: "Released",
  cancelled: "Cancelled",
};
