import { expect, test } from "bun:test";
import { DAY_MS, MAX_LIMIT_CENTS, MAX_LIMIT_WINDOW_MS, MIN_LIMIT_CENTS } from "@entole/mandate";
import * as mcp from "../../mcp/src/tools.ts";

// The MCP server and the web form cannot import the domain, so they keep copies of its limits
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
