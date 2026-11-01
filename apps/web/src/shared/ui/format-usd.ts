/** A dollar amount as the app shows it, e.g. 80 or "80.00" becomes "$80.00". */
export const formatUsd = (amount: number | string) => `$${Number(amount).toFixed(2)}`;
