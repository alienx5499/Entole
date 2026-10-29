import { expect, test } from "bun:test";
import { usd } from "@entole/shared-kernel";
import { routes } from "../src/routes/index.ts";
import { body, createFunded, harness, login } from "./harness.ts";

// docs/openapi.yaml feeds the generated SDK, so it must name real routes and promise only fields
// the routes really return.

type Schema = {
  $ref?: string;
  required?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  allOf?: Schema[];
  nullable?: boolean;
  enum?: unknown[];
};
type Operation = {
  operationId: string;
  responses: Record<string, { content?: Record<string, { schema: Schema }> }>;
};
type Spec = {
  info: { version: string };
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, Schema> };
};

const spec = Bun.YAML.parse(
  await Bun.file(new URL("../../../docs/openapi.yaml", import.meta.url)).text(),
) as Spec;
const pkg = (await Bun.file(new URL("../package.json", import.meta.url)).json()) as {
  version: string;
};
const METHODS = new Set(["get", "post", "put", "patch", "delete"]);
const operations = Object.entries(spec.paths).flatMap(([path, item]) =>
  Object.entries(item)
    .filter(([method]) => METHODS.has(method))
    .map(([method, op]) => ({ key: `${method.toUpperCase()} ${path}`, op })),
);

const resolve = (s: Schema): Schema =>
  s.$ref ? resolve(spec.components.schemas[s.$ref.split("/").at(-1) ?? ""] ?? {}) : s;

// Paths in `value` where a property the schema requires is absent, or null where not nullable.
const missing = (schema: Schema, value: unknown, at: string): string[] => {
  const s = resolve(schema);
  if (value === null) return s.nullable ? [] : [`${at} is null`];
  if (s.allOf) return s.allOf.flatMap((b) => missing(b, value, at));
  if (Array.isArray(value))
    return s.items ? value.flatMap((v, i) => missing(s.items as Schema, v, `${at}[${i}]`)) : [];
  if (typeof value !== "object" || value === undefined) return [];
  const o = value as Record<string, unknown>;
  return [
    ...(s.required ?? []).filter((k) => !(k in o)).map((k) => `${at}.${k} missing`),
    ...Object.entries(s.properties ?? {}).flatMap(([k, p]) =>
      k in o ? missing(p, o[k], `${at}.${k}`) : [],
    ),
  ];
};

const okSchema = (key: string): Schema => {
  const op = operations.find((o) => o.key === key)?.op;
  const schema = op?.responses["200"]?.content?.["application/json"]?.schema;
  if (!schema) throw new Error(`${key} has no 200 JSON schema in the spec`);
  return schema;
};

test("the spec version is the API package version", () => {
  expect(spec.info.version).toBe(pkg.version);
});

test("every spec operation is a real route", () => {
  const real = new Set(routes.map(([m, p]) => `${m} ${p.replace(/:(\w+)/g, "{$1}")}`));
  expect(operations.length).toBeGreaterThan(0);
  for (const { key } of operations) expect(real.has(key) ? key : `${key} is not routed`).toBe(key);
});

test("each operation's real response has every field the spec requires", async () => {
  const h = harness();
  const cookie = await login(h);
  const minted = await h.call("/api/tokens", { method: "POST", body: '{"name":"sdk"}', cookie });
  const { token } = (await minted.json()) as { token: string };
  const auth = { headers: { authorization: `Bearer ${token}` } };

  // One order bought through the watcher, so purchase, receipt and the closed AP2 mandates are set.
  const bought = await createFunded(h, cookie);
  h.offer.price = usd(16900);
  await h.call(`/api/mandates/${bought}/check-now`, { method: "POST", cookie });
  h.offer.price = usd(18000);
  // createFunded returns with PayPal order-1, so the second order is funded with order-2.
  const second = await h.call("/api/mandates", { method: "POST", body: body(), cookie });
  const watching = ((await second.json()) as { id: string }).id;
  await h.call(`/api/paypal/return?mandate=${watching}&token=order-2`, { cookie });

  const samples: [key: string, path: string, init?: RequestInit][] = [
    ["GET /api/me", "/api/me"],
    ["POST /api/mandates", "/api/mandates", { method: "POST", body: body() }],
    ["GET /api/mandates", "/api/mandates"],
    ["GET /api/mandates/{id}", `/api/mandates/${bought}`],
    ["GET /api/mandates/{id}/ap2", `/api/mandates/${bought}/ap2`],
    [
      "POST /api/mandates/{id}/schedule/propose",
      `/api/mandates/${watching}/schedule/propose`,
      { method: "POST", body: "{}" },
    ],
    ["POST /api/mandates/{id}/close", `/api/mandates/${watching}/close`, { method: "POST" }],
  ];
  // A spec operation without a sample here would go unchecked.
  expect(new Set(samples.map(([key]) => key))).toEqual(new Set(operations.map((o) => o.key)));

  for (const [key, path, init] of samples) {
    const res = await h.call(path, { ...init, ...auth });
    expect(`${key} ${res.status}`).toBe(`${key} 200`);
    expect(missing(okSchema(key), await res.json(), path)).toEqual([]);
  }

  const bad = await h.call("/api/mandates", {
    method: "POST",
    body: body({ validDays: 0 }),
    ...auth,
  });
  const err = await bad.json();
  expect(missing({ $ref: "#/components/schemas/ApiError" }, err, "error")).toEqual([]);
  const code = resolve({ $ref: "#/components/schemas/ApiError" }).properties?.error;
  expect(code && resolve(code).enum).toContain((err as { error: string }).error);
});
