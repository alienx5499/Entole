import type { MandateLock } from "./ports.ts";

// Promise chain per mandate id. Serialises work inside one process only: tests, local dev, and
// the default when no lock is wired. Production wires PostgresMandateLock, which spans processes.
export class InMemoryMandateLock implements MandateLock {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(mandateId: string, fn: () => Promise<T>): Promise<T> {
    const run = (this.tails.get(mandateId) ?? Promise.resolve()).then(fn, fn);
    const tail = run.catch(() => undefined);
    this.tails.set(mandateId, tail);
    void tail.then(() => {
      if (this.tails.get(mandateId) === tail) this.tails.delete(mandateId);
    });
    return run;
  }
}

const processLock = new InMemoryMandateLock();

export const withMandateLock = <T>(
  mandateId: string,
  fn: () => Promise<T>,
  lock: MandateLock = processLock,
): Promise<T> => lock.run(mandateId, fn);
