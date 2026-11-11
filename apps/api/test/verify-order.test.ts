import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../..");
const SCRIPT = join(ROOT, "apps/api/src/verify-order.ts");
const EXAMPLE = join(ROOT, "docs/examples/mandate.example.json");

const run = (file: string) => {
  const p = Bun.spawnSync([process.execPath, SCRIPT, file], {
    env: {},
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: p.exitCode, out: p.stdout.toString() };
};

test("verify:order passes the example mandate as signed", () => {
  const r = run(EXAMPLE);
  expect(r.code).toBe(0);
  expect(r.out).toContain("match     stored digest");
});

test("verify:order fails a mandate whose limit was raised after signing", async () => {
  const mandate = await Bun.file(EXAMPLE).json();
  mandate.terms.maxUnitPrice.cents = 99_900;
  mandate.terms.budget.cents = 99_900;
  const file = join(await mkdtemp(join(tmpdir(), "entole-verify-")), "tampered.json");
  await Bun.write(file, JSON.stringify(mandate));
  const r = run(file);
  expect(r.code).toBe(1);
  expect(r.out).toContain("MISMATCH  stored digest");
});
