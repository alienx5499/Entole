/// <reference types="bun" />
import { afterEach, describe, expect, test } from "bun:test";
import { ApiError, getMe } from "../src/shared/api/client";

const realFetch = globalThis.fetch;
const respond = (res: Response) => {
  globalThis.fetch = (async () => res) as unknown as typeof fetch;
};
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("api client status handling", () => {
  test("returns the parsed body on a 2xx", async () => {
    respond(Response.json({ id: "u1" }));
    expect(await getMe({ redirectOn401: false })).toEqual({ id: "u1" } as never);
  });

  test("throws ApiError with the server's error and field on a non-2xx", async () => {
    respond(Response.json({ error: "bad_limit", field: "limitPrice" }, { status: 400 }));
    const err = await getMe({ redirectOn401: false }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, error: "bad_limit", field: "limitPrice" });
  });

  test("falls back to the status text when the error body is not JSON", async () => {
    respond(new Response("<html>oops</html>", { status: 502, statusText: "Bad Gateway" }));
    const err = await getMe({ redirectOn401: false }).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 502, error: "Bad Gateway" });
  });
});
