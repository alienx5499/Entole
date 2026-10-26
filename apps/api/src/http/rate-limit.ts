// Fixed-window counter per key.
// Per-process memory; move to a shared store if the API ever runs on several instances.
export class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  // True when the call is allowed, false when the key is over its limit for this window.
  hit(key: string): boolean {
    const t = this.now();
    if (this.windows.size > 10_000)
      for (const [k, w] of this.windows) if (w.resetAt <= t) this.windows.delete(k);
    const w = this.windows.get(key);
    if (!w || w.resetAt <= t) {
      this.windows.set(key, { count: 1, resetAt: t + this.windowMs });
      return true;
    }
    w.count++;
    return w.count <= this.limit;
  }
}
