// The redacted address PayPal shows Entole while the buyer is still on the approval page: no
// street lines, so a PO box cannot be told apart here.
export type ShipToRegion = { country: string; region?: string; postalCode?: string };

// The codes PayPal's order update callback accepts in a 422 answer for a refused address.
export type ShippingIssue = "COUNTRY_ERROR" | "STATE_ERROR" | "ZIP_ERROR" | "ADDRESS_ERROR";

// Whether the signed shops can ship there; null means yes. Every shop on a shortlist comes from
// the US catalog, so a US address is the whole rule today. Per-shop regions replace it once the
// catalog carries them.
export const shippingIssue = (to: ShipToRegion): ShippingIssue | null =>
  to.country.toUpperCase() === "US" ? null : "COUNTRY_ERROR";
