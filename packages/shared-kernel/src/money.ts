export type Money = { readonly cents: number; readonly currency: "USD" };

export const usd = (cents: number): Money => {
  if (!Number.isSafeInteger(cents) || cents < 0)
    throw new RangeError(`Invalid USD cents: ${cents}`);
  return { cents, currency: "USD" };
};

export const parseUsd = (decimal: string): Money => {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(decimal.trim());
  if (!m) throw new RangeError(`Invalid USD amount: ${decimal}`);
  return usd(Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0")));
};

export const formatUsd = (m: Money): string =>
  `${Math.floor(m.cents / 100)}.${String(m.cents % 100).padStart(2, "0")}`;

export const add = (a: Money, b: Money): Money => usd(a.cents + b.cents);
export const sub = (a: Money, b: Money): Money => usd(a.cents - b.cents);
export const lte = (a: Money, b: Money): boolean => a.cents <= b.cents;
export const min = (a: Money, b: Money): Money => (a.cents <= b.cents ? a : b);
