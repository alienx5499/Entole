import type { MandateRepository, ProductSearch, ResolvedOffer } from "@entole/mandate";
import type { Clock, Money } from "@entole/shared-kernel";
import { replayIndex } from "../domain/replay-schedule.ts";

// Demo replay: the live offer (merchant, attributes, url) with only its price swapped for a
// recorded history point, so everything downstream (check, capture) is the live code path.
type OfferRequest = Parameters<ProductSearch["resolveOffer"]>[0];

const norm = (s: string) => s.trim().toLowerCase();
const offerKey = (i: OfferRequest): string =>
  JSON.stringify([
    i.productId,
    norm(i.merchant),
    Object.entries(i.options)
      .map(([k, v]) => [norm(k), norm(v)])
      .sort(([a = ""], [b = ""]) => (a < b ? -1 : a > b ? 1 : 0)),
  ]);

export const withReplayPrices = (
  search: ProductSearch,
  points: Money[],
  startedAt: Date,
  clock: Clock,
  msPerPoint = 2000,
): ProductSearch => {
  if (points.length === 0) throw new RangeError("Replay needs at least one price point");
  if (!(msPerPoint > 0)) throw new RangeError("msPerPoint must be above zero");
  // One live lookup per candidate for this replay's lifetime. Safe because merchant, attributes
  // and url do not change within a ~60s replay, only the price is swapped per tick, and capture
  // still runs the deterministic check on the offer it is given. The in-flight promise is shared
  // so concurrent ticks make one call; a failure is dropped so the next tick retries.
  const liveOffers = new Map<string, Promise<ResolvedOffer | null>>();
  const liveOffer = (i: OfferRequest): Promise<ResolvedOffer | null> => {
    const key = offerKey(i);
    const cached = liveOffers.get(key);
    if (cached) return cached;
    const pending = search.resolveOffer(i);
    liveOffers.set(key, pending);
    pending.catch(() => liveOffers.delete(key));
    return pending;
  };
  return {
    search: (q) => search.search(q),
    async resolveOffer(i) {
      const live = await liveOffer(i);
      if (!live) return null;
      const at = replayIndex(
        clock.now().getTime() - startedAt.getTime(),
        msPerPoint,
        points.length,
      );
      return { ...live, price: points[at] as Money };
    },
  };
};

// Records on the order's timeline that a demo replay started over `points` recorded prices.
export const recordReplayStarted = (
  deps: { repo: Pick<MandateRepository, "appendAudit">; clock: Clock },
  mandateId: string,
  points: number,
): Promise<void> =>
  deps.repo.appendAudit(mandateId, {
    at: deps.clock.now(),
    kind: "agent_step",
    message: `Price replay started: ${points} recorded daily prices`,
    data: { replay: "started" },
  });
