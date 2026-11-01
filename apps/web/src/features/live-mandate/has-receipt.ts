import type { MandateView } from "@/shared/api";

/** True once PayPal has been involved: a hold exists or PayPal has sent a confirmation. */
export const hasReceipt = (m: MandateView) =>
  m.receipt.authorizationId !== null || m.receipt.confirmations.length > 0;
