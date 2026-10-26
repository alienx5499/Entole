// Import rules for the backend packages and the apps, checked by reading the source with plain fs.
import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const ROOT = resolve(import.meta.dir, "../../..");
const SOURCE = /\.(ts|tsx)$/;

const walk = (dir: string): string[] => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === "dist" || name === ".next") return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
};

const packages = readdirSync(join(ROOT, "packages")).filter((p) =>
  existsSync(join(ROOT, "packages", p, "package.json")),
);

const SPECIFIER =
  /(?:^|[\s;])(?:import|export)\s(?:[^"';]*?\sfrom\s)?["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;

const importsOf = (file: string): string[] => {
  const code = readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  return [...code.matchAll(SPECIFIER)].map((m) => m[1] ?? m[2] ?? "");
};

// Where a file sits: its package (or app) and its layer.
const locate = (path: string) => {
  const parts = relative(ROOT, path).split(sep);
  if (parts[0] === "packages" && parts[2] === "src")
    return { owner: parts[1] ?? "", layer: parts.length > 4 ? (parts[3] ?? "") : "" };
  return { owner: parts.slice(0, 2).join("/"), layer: "" };
};

type Rule = (file: string, spec: string) => string | null;

const ENTOLE = /^@entole\/([^/]+)(\/.*)?$/;
const isRelative = (spec: string) => spec.startsWith(".");

const backendRule: Rule = (file, spec) => {
  const here = locate(file);
  const pkg = ENTOLE.exec(spec);
  if (pkg?.[1] === "testing") return "only tests may import @entole/testing";
  if (pkg?.[2]) return "import other packages only through their index, never a deep path";
  if (pkg && pkg[1] === here.owner) return "import your own package with a relative path";
  if (isRelative(spec)) {
    const target = locate(resolve(dirname(file), spec));
    if (target.owner !== here.owner) return "relative import leaves the package";
    const allowed: Record<string, string[]> = {
      domain: ["domain"],
      application: ["domain", "application"],
      infrastructure: ["domain", "application", "infrastructure"],
    };
    const ok = allowed[here.layer];
    if (ok && !ok.includes(target.layer)) return `${here.layer} may not import ${target.layer}`;
    return null;
  }
  if (here.owner === "shared-kernel" && pkg) return "shared-kernel depends on no other package";
  if (here.layer === "domain" && spec !== "@entole/shared-kernel" && spec !== "node:crypto")
    return "domain may import only its own domain, @entole/shared-kernel and node:crypto";
  if (here.layer === "application" && !pkg)
    return "application may import only its context, shared-kernel and other package indexes";
  return null;
};

const violations = (files: string[], rule: Rule): string[] =>
  files.flatMap((file) =>
    importsOf(file).flatMap((spec) => {
      const why = rule(file, spec);
      return why ? [`${relative(ROOT, file)} imports "${spec}": ${why}`] : [];
    }),
  );

const backendFiles = [
  ...packages.flatMap((p) => walk(join(ROOT, "packages", p, "src"))),
  ...walk(join(ROOT, "apps/api/src")),
].filter((f) => SOURCE.test(f));

test("the scan sees every backend layer", () => {
  const layers = new Set(backendFiles.map((f) => locate(f).layer));
  for (const layer of ["domain", "application", "infrastructure"]) expect(layers).toContain(layer);
  expect(backendFiles.length).toBeGreaterThan(40);
  expect(backendFiles.flatMap(importsOf).length).toBeGreaterThan(100);
});

test("backend imports follow the layer and package rules", () => {
  expect(violations(backendFiles, backendRule)).toEqual([]);
});

test("the rule itself rejects what it should", () => {
  const domain = join(ROOT, "packages/mandate/src/domain/x.ts");
  const app = join(ROOT, "packages/shopping/src/application/x.ts");
  const api = join(ROOT, "apps/api/src/x.ts");
  expect(backendRule(domain, "bun")).not.toBeNull();
  expect(backendRule(domain, "@entole/shopping")).not.toBeNull();
  expect(backendRule(domain, "../application/ports.ts")).not.toBeNull();
  expect(backendRule(domain, "node:crypto")).toBeNull();
  expect(backendRule(app, "../infrastructure/groq/groq-agent-model.ts")).not.toBeNull();
  expect(backendRule(app, "@entole/mandate/src/domain/check.ts")).not.toBeNull();
  expect(backendRule(app, "../../../mandate/src/index.ts")).not.toBeNull();
  expect(backendRule(app, "@entole/mandate")).toBeNull();
  expect(backendRule(api, "@entole/testing")).not.toBeNull();
});

test("package dependencies have no cycle", () => {
  const deps = new Map(
    packages.map((p) => {
      const json = JSON.parse(readFileSync(join(ROOT, "packages", p, "package.json"), "utf8"));
      const names = Object.keys(json.dependencies ?? {}).map((d) => ENTOLE.exec(d)?.[1] ?? "");
      return [p, names.filter((d) => d !== "")];
    }),
  );
  const cycles: string[] = [];
  const visit = (p: string, path: string[]) => {
    if (path.includes(p)) return void cycles.push([...path, p].join(" -> "));
    for (const d of deps.get(p) ?? []) visit(d, [...path, p]);
  };
  for (const p of packages) visit(p, []);
  expect(cycles).toEqual([]);
});

test("the web app imports no @entole package", () => {
  const web = walk(join(ROOT, "apps/web/src")).filter((f) => SOURCE.test(f));
  expect(
    violations(web, (_f, spec) => (spec.startsWith("@entole/") ? "web is standalone" : null)),
  ).toEqual([]);
});

test("no file is named utils or helpers", () => {
  const all = [
    ...walk(join(ROOT, "packages")),
    ...walk(join(ROOT, "apps/api")),
    ...walk(join(ROOT, "apps/web/src")),
  ];
  expect(all.filter((f) => /utils|helpers/i.test(relative(ROOT, f)))).toEqual([]);
});
