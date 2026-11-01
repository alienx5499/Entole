import { expect, test } from "bun:test";
import { MAX_TOKEN_NAME } from "@entole/identity";
import {
  AUDIT_KINDS,
  DAY_MS,
  MANDATE_OUTCOMES,
  MAX_LIMIT_CENTS,
  MAX_LIMIT_WINDOW_MS,
  MIN_LIMIT_CENTS,
} from "@entole/mandate";
import * as mcp from "../../mcp/src/tools.ts";

// The MCP server and the web cannot import the domain, so they keep copies of its limits and lists
// for early hints. These checks keep the copies equal to the domain.

type Limits = { MIN_LIMIT_USD: number; MAX_LIMIT_USD: number; MAX_VALID_DAYS: number };
// A dynamic import: the web app is not part of the backend type build.
const web = (await import(
  new URL("../../web/src/features/create-mandate/limits.ts", import.meta.url).href
)) as Limits;

test.each([
  ["mcp", mcp as Limits],
  ["web", web],
])("the %s copies of the limits equal the domain's", (_name, copy) => {
  expect(copy.MIN_LIMIT_USD * 100).toBe(MIN_LIMIT_CENTS);
  expect(copy.MAX_LIMIT_USD * 100).toBe(MAX_LIMIT_CENTS);
  expect(copy.MAX_VALID_DAYS * DAY_MS).toBe(MAX_LIMIT_WINDOW_MS);
});

test("the web copy of the token name limit equals the identity domain's", async () => {
  const connect = (await import(
    new URL("../../web/src/features/connect-ai/limits.ts", import.meta.url).href
  )) as { MAX_TOKEN_NAME: number };
  expect(connect.MAX_TOKEN_NAME).toBe(MAX_TOKEN_NAME);
});

test("the web's audit kinds and outcomes equal the mandate domain's", async () => {
  const api = (await import(
    new URL("../../web/src/shared/api/types.ts", import.meta.url).href
  )) as { AUDIT_KINDS: readonly string[]; MANDATE_OUTCOMES: readonly string[] };
  expect(api.AUDIT_KINDS).toEqual(AUDIT_KINDS);
  expect(api.MANDATE_OUTCOMES).toEqual(MANDATE_OUTCOMES);
});
