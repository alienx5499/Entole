import { formatUsd, type Money, usd } from "@entole/shared-kernel";

const MIN_PEERS = 2;
const MIN_SIMILAR = 3;

const median = (cents: number[]): number => {
  const s = [...cents].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1
    ? (s[mid] as number)
    : Math.round(((s[mid - 1] as number) + (s[mid] as number)) / 2);
};

// An offer under half the usual price is more likely a scam or a wrong item than a bargain.
// The yardstick is other sellers of the same product; a listing with too few of those is compared
// with the other products the same search found (one price each). Returns the rejection detail,
// or null when the price is normal or there is too little to judge.
export const priceOutlierDetail = (
  price: Money,
  peers: Money[],
  similar: Money[] = [],
): string | null => {
  const [yardstick, label] =
    peers.length >= MIN_PEERS
      ? [peers, "this product"]
      : similar.length >= MIN_SIMILAR
        ? [similar, "similar items in this search"]
        : [null, ""];
  if (!yardstick) return null;
  const usual = median(yardstick.map((p) => p.cents));
  return price.cents * 2 < usual
    ? `$${formatUsd(price)} is far below the usual $${formatUsd(usd(usual))} for ${label}`
    : null;
};
