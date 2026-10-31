// Event ids seen lately, so a redelivered webhook is answered without acting twice.
// shortcut: in memory, so a restart or a second instance forgets; a repeat check is still safe
// (mandate lock, one PayPal-Request-Id). Move to Postgres if the API ever runs more than one instance.
// Two identical deliveries at the same moment can both pass has() before either is remembered;
// safe for the same reason.
export class RecentIds {
  // Insertion order is expiry order, since every id lives the same ttl.
  private readonly expires = new Map<string, number>();

  constructor(
    private readonly capacity = 10_000,
    private readonly ttlMs = 86_400_000,
  ) {}

  has(id: string, now: Date): boolean {
    return (this.expires.get(id) ?? 0) > now.getTime();
  }

  remember(id: string, now: Date): void {
    this.expires.delete(id);
    this.expires.set(id, now.getTime() + this.ttlMs);
    for (const [oldest, at] of this.expires) {
      if (at > now.getTime() && this.expires.size <= this.capacity) break;
      this.expires.delete(oldest);
    }
  }
}
