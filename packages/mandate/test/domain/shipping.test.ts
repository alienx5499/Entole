import { expect, test } from "bun:test";
import { shippingIssue } from "../../src/index.ts";

test("the signed US shops ship to US addresses only", () => {
  expect(shippingIssue({ country: "US", region: "TX", postalCode: "75001" })).toBeNull();
  expect(shippingIssue({ country: "us" })).toBeNull();
  expect(shippingIssue({ country: "CA", region: "ON" })).toBe("COUNTRY_ERROR");
  // Territories have their own country codes in PayPal addresses.
  expect(shippingIssue({ country: "PR" })).toBe("COUNTRY_ERROR");
});
