import { runWatcherTick, withReplayPrices } from "@entole/limit-order";
import type { Mandate, ProductSearch } from "@entole/mandate";
import type { Money } from "@entole/shared-kernel";
import type { Container } from "../composition-root.ts";

export const REPLAY_MS_PER_POINT = 2000;
const HISTORY_DAYS = 30;

export type PricePoint = { at: Date; price: Money };

// The in-memory side of limit orders: which mandates are active (the Neon cost guard),
// cached price history for the chart, and when each replay started.
// Replay state lives in process memory: a restart ends a running replay and the live feed resumes.
export class LimitWatch {
  private readonly active = new Set<string>();
  private readonly histories = new Map<string, Map<string, PricePoint[]>>();
  private readonly replays = new Map<string, Date>();
  private ticking = false;

  constructor(private readonly c: Container) {}

  // One DB read at boot; after that the set is kept current by fund, close and the ticks.
  async load(): Promise<void> {
    for (const m of await this.c.repo.listFundedLimit()) this.active.add(m.id);
  }

  track(mandateId: string): void {
    this.active.add(mandateId);
  }

  untrack(mandateId: string): void {
    this.active.delete(mandateId);
  }

  get activeCount(): number {
    return this.active.size;
  }

  replayStartedAt(mandateId: string): Date | null {
    return this.replays.get(mandateId) ?? null;
  }

  // Live Channel3 prices, or the replayed history for candidates that have one.
  priceSourceFor(mandateId: string): ProductSearch {
    const startedAt = this.replays.get(mandateId);
    const history = this.histories.get(mandateId);
    if (!startedAt || !history) return this.c.search;
    const perProduct = new Map<string, ProductSearch>();
    for (const [productId, points] of history)
      if (points.length > 0)
        perProduct.set(
          productId,
          withReplayPrices(
            this.c.search,
            points.map((p) => p.price),
            startedAt,
            this.c.clock,
            REPLAY_MS_PER_POINT,
          ),
        );
    return {
      search: (q) => this.c.search.search(q),
      resolveOffer: (i) => (perProduct.get(i.productId) ?? this.c.search).resolveOffer(i),
    };
  }

  // Runs the same tick as the timer for one mandate; drops it from the set as soon as it is closed
  // (or is no longer watchable, e.g. its release was given up after repeated void failures).
  async check(mandateId: string): Promise<{ checked: number; captured: string[] }> {
    const { closed, ...result } = await runWatcherTick(
      { ...this.c, prices: this.priceSourceFor(mandateId) },
      { mandateId },
    );
    if (result.checked === 0 || closed.includes(mandateId)) this.untrack(mandateId);
    return result;
  }

  // Timer entry point. With no active limit mandate it does no DB work at all.
  async tick(): Promise<void> {
    if (this.ticking || this.active.size === 0) return;
    this.ticking = true;
    try {
      for (const id of [...this.active])
        await this.check(id).catch((err: unknown) => console.error(err));
    } finally {
      this.ticking = false;
    }
  }

  // Price history per candidate, fetched once per mandate. A failed fetch gives an empty chart line.
  async history(m: Mandate): Promise<Map<string, PricePoint[]>> {
    const cached = this.histories.get(m.id);
    if (cached) return cached;
    const loaded = new Map<string, PricePoint[]>();
    for (const c of m.terms.candidates)
      loaded.set(
        c.productId,
        await this.c.tracker
          .history(c.productId, HISTORY_DAYS)
          .then((ps) => [...ps].sort((a, b) => a.at.getTime() - b.at.getTime()))
          .catch((err: unknown) => {
            console.error(err);
            return [];
          }),
      );
    this.histories.set(m.id, loaded);
    return loaded;
  }

  // Returns the start time and the longest history length, or null when there is nothing to play.
  async startReplay(m: Mandate): Promise<{ startedAt: Date; points: number } | null> {
    this.histories.delete(m.id); // a fresh fetch, in case an earlier one failed
    const points = Math.max(0, ...[...(await this.history(m)).values()].map((p) => p.length));
    if (points === 0) return null;
    const startedAt = this.c.clock.now();
    this.replays.set(m.id, startedAt);
    return { startedAt, points };
  }
}
