import {
  closeMandate,
  MAX_VOID_ATTEMPTS,
  type Mandate,
  type MandateDeps,
  type ProductSearch,
  proposeOrder,
  ReleaseFailed,
  type ResolvedOffer,
  shopsOf,
} from "@entole/mandate";
import { lte } from "@entole/shared-kernel";

// `prices` is the live ProductSearch, or the same search wrapped by withReplayPrices.
export type WatcherDeps = MandateDeps & { prices: ProductSearch };

// Up to 3 candidates times 5 shops; a handful of catalog calls in flight at once.
const QUOTE_BATCH = 5;

const isExpired = (m: Mandate, now: Date): boolean =>
  now.getTime() >= m.terms.validUntil.getTime() ||
  (m.authorization !== undefined && now.getTime() >= m.authorization.expiresAt.getTime());

// The price compare is only a trigger: proposeOrder re-quotes, runs checkProposal and captures,
// so the pay/no-pay call stays in the domain. `onCapture` fires before the close so a failed void
// still reports the capture; the exhausted mandate is picked up and closed on the next tick.
// Returns true when this call closed the mandate.
const watchOne = async (
  deps: WatcherDeps,
  m: Mandate,
  onCapture: (id: string) => void,
): Promise<boolean> => {
  if (m.status === "exhausted" || isExpired(m, deps.clock.now())) {
    await closeMandate(deps, m.id);
    return true;
  }
  // Every signed shop of every candidate is quoted, a few at a time, then the offers at or under
  // the limit are proposed cheapest first. proposeOrder re-quotes and runs checkProposal, so a shop
  // that fails a check is audited and skipped, and the first allowed one is the cheapest passing.
  // One failed shop quote counts as no offer, so a flaky shop cannot hold up a cheaper one; when
  // every quote fails the error is raised and audited, as before. Ties keep candidate and shop order, so replay (one
  // recorded price per product) buys from the shop found at shortlist.
  const shops = m.terms.candidates.flatMap((c) =>
    shopsOf(c).map((merchant) => ({ ...c, merchant })),
  );
  const settled: PromiseSettledResult<ResolvedOffer | null>[] = [];
  for (let k = 0; k < shops.length; k += QUOTE_BATCH)
    settled.push(
      ...(await Promise.allSettled(
        shops.slice(k, k + QUOTE_BATCH).map((s) => deps.prices.resolveOffer(s)),
      )),
    );
  const failed = settled.find((q) => q.status === "rejected");
  if (failed && settled.every((q) => q.status === "rejected")) throw failed.reason;
  const quotes = settled.map((q) => (q.status === "fulfilled" ? q.value : null));
  const affordable = shops
    .map((shop, k) => ({ shop, offer: quotes[k] ?? null }))
    .filter(
      (q): q is { shop: (typeof shops)[number]; offer: ResolvedOffer } =>
        q.offer !== null && lte(q.offer.price, m.terms.maxUnitPrice),
    )
    .sort((a, b) => a.offer.price.cents - b.offer.price.cents);
  for (const { shop } of affordable) {
    const { verdict } = await proposeOrder(
      { ...deps, search: deps.prices },
      {
        mandateId: m.id,
        productId: shop.productId,
        merchant: shop.merchant,
        options: shop.options,
        source: "watcher",
        shopsCompared: quotes.filter((q) => q !== null).length,
      },
    );
    if (verdict.kind === "allow") {
      onCapture(m.id);
      await closeMandate(deps, m.id);
      return true;
    }
  }
  return false;
};

const watchable = (m: Mandate | null): m is Mandate =>
  m !== null &&
  (m.status === "funded" || m.status === "exhausted") &&
  m.terms.kind === "limit" &&
  (m.voidAttempts ?? 0) < MAX_VOID_ATTEMPTS;

export const runWatcherTick = async (
  deps: WatcherDeps,
  i: { mandateId?: string },
): Promise<{ checked: number; captured: string[]; closed: string[] }> => {
  const mandates = (
    i.mandateId ? [await deps.repo.get(i.mandateId)] : await deps.repo.listFundedLimit()
  ).filter(watchable);
  const captured: string[] = [];
  const closed: string[] = [];
  for (const m of mandates) {
    // One broken mandate (PayPal or catalog error) must not starve the others in this tick.
    try {
      if (await watchOne(deps, m, (id) => captured.push(id))) closed.push(m.id);
    } catch (err) {
      console.error(err); // server-side only
      if (err instanceof ReleaseFailed) continue; // audited once by closeMandate, never retried
      await deps.repo
        .appendAudit(m.id, {
          at: deps.clock.now(),
          kind: "agent_step",
          message: "Watcher check failed, will retry on the next tick",
          data: { error: err instanceof Error ? err.message.slice(0, 200) : "unknown error" },
        })
        .catch((auditErr: unknown) => console.error(auditErr));
    }
  }
  return { checked: mandates.length, captured, closed };
};
