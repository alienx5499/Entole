import { describe, expect, test } from "bun:test";
import { InMemoryMandateLock, withMandateLock } from "../../src/index.ts";

const tick = () => new Promise((r) => setTimeout(r, 1));

describe("InMemoryMandateLock", () => {
  test("serialises work on one mandate, keeps going after a throw, runs other mandates freely", async () => {
    const lock = new InMemoryMandateLock();
    const log: string[] = [];
    const step =
      (name: string, fail = false) =>
      async () => {
        log.push(`${name}:start`);
        await tick();
        log.push(`${name}:end`);
        if (fail) throw new Error(name);
        return name;
      };
    const a = lock.run("m1", step("a", true));
    const b = lock.run("m1", step("b"));
    const other = lock.run("m2", step("x"));
    await expect(a).rejects.toThrow("a");
    expect(await b).toBe("b");
    expect(await other).toBe("x");
    const m1 = log.filter((l) => !l.startsWith("x"));
    expect(m1).toEqual(["a:start", "a:end", "b:start", "b:end"]);
    // m2 did not wait for m1.
    expect(log.indexOf("x:start")).toBeLessThan(log.indexOf("a:end"));
  });

  test("withMandateLock runs through the lock it is given", async () => {
    const seen: string[] = [];
    const lock = {
      run: <T>(id: string, fn: () => Promise<T>) => {
        seen.push(id);
        return fn();
      },
    };
    expect(await withMandateLock("m9", async () => 7, lock)).toBe(7);
    expect(seen).toEqual(["m9"]);
  });
});
