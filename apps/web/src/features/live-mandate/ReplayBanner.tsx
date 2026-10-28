import type { MandateView } from "@/shared/api";

export function ReplayBanner({ mandate }: { mandate: MandateView }) {
  if (!mandate.replay) return null;
  return (
    <div className="banner-replay">
      REPLAY: Channel3 price history, last 30 days, about 60 seconds. Sandbox money.
    </div>
  );
}
