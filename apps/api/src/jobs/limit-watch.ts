import { type PricePoint, runWatcherTick, withReplayPrices } from "@entole/limit-order";
import type { Mandate, ProductSearch } from "@entole/mandate";
import type { Container } from "../composition-root.ts";
import type { CheckResult } from "../workflows/watch-tasks.ts";

export const REPLAY_MS_PER_POINT = 2000;
const HISTORY_DAYS = 30;

// The in-memory side of limit orders: which mandates are active (the Neon cost guard),
// cached price history for the chart, and when each replay started.
// Replay state lives in process memory: a restart ends a running replay and the live feed resumes.
export class LimitWatch {
  private readonly active = new Set<string>();
  private readonly histories = new Map<string, Map<string, PricePoint[]>>();
  private readonly replays = new Map<string, Date>();
  // Built once per replay, so each wrapper's live offer lookup lasts the whole replay.
  private readonly replaySources = new Map<string, ProductSearch>();
  // Extra checks the buyer accepted, one per mandate. In memory like replays: a restart drops it
  // and the regular tick carries on; the audit trail still shows what was agreed.
  private readonly scheduled = new Map<
    string,
    { at: Date; timer: ReturnType<typeof setTimeout> }
  >();
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
    this.replaySources.delete(mandateId);
    clearTimeout(this.scheduled.get(mandateId)?.timer);
    this.scheduled.delete(mandateId);
  }

  // Arms one extra check at `at`, replacing any earlier one. The caller has already checked `at`
  // against the signed window; the check itself re-reads the mandate, so a closed one is a no-op.
  scheduleCheck(mandateId: string, at: Date): void {
    clearTimeout(this.scheduled.get(mandateId)?.timer);
    const delay = Math.max(0, at.getTime() - this.c.clock.now().getTime());
    const timer = setTimeout(() => {
      this.scheduled.delete(mandateId);
      void this.check(mandateId).catch((err: unknown) => console.error(err));
    }, delay);
    // A pending extra check must not keep the process (or a test run) alive.
    (timer as { unref?: () => void }).unref?.();
    this.scheduled.set(mandateId, { at, timer });
  }

  scheduledCheckAt(mandateId: string): Date | null {
    return this.scheduled.get(mandateId)?.at ?? null;
  }

  get activeCount(): number {
    return this.active.size;
  }

  replayStartedAt(mandateId: string): Date | null {
    return this.replays.get(mandateId) ?? null;
  }

  // Live Channel3 prices, or the replayed history for candidates that have one.
  priceSourceFor(mandateId: string): ProductSearch {
    return this.replaySources.get(mandateId) ?? this.c.search;
  }

  private replaySource(history: Map<string, PricePoint[]>, startedAt: Date): ProductSearch {
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
  async check(mandateId: string): Promise<CheckResult> {
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
    const loaded = new Map(
      await Promise.all(
        m.terms.candidates.map(
          async (c) =>
            [
              c.productId,
              await this.c.tracker
                .history(c.productId, HISTORY_DAYS)
                .then((ps) => [...ps].sort((a, b) => a.at.getTime() - b.at.getTime()))
                .catch((err: unknown): PricePoint[] => {
                  console.error(err);
                  return [];
                }),
            ] as const,
        ),
      ),
    );
    this.histories.set(m.id, loaded);
    return loaded;
  }

  // Returns the start time and the longest history length, or null when there is nothing to play.
  async startReplay(m: Mandate): Promise<{ startedAt: Date; points: number } | null> {
    this.histories.delete(m.id); // a fresh fetch, in case an earlier one failed
    this.replaySources.delete(m.id);
    const history = await this.history(m);
    const points = Math.max(0, ...[...history.values()].map((p) => p.length));
    if (points === 0) return null;
    const startedAt = this.c.clock.now();
    this.replays.set(m.id, startedAt);
    this.replaySources.set(m.id, this.replaySource(history, startedAt));
    return { startedAt, points };
  }
}
