import type { Clock, IdGenerator, Logger } from "@entole/shared-kernel";

export class FixedClock implements Clock {
  constructor(private current: Date) {}
  now() {
    return new Date(this.current);
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export class SequentialIds implements IdGenerator {
  private n = 0;
  next(prefix: string) {
    return `${prefix}-${++this.n}`;
  }
}

// Keeps what would have been logged, so a test can assert on it without console noise.
export class RecordingLogger implements Logger {
  readonly errors: { message: string; err?: unknown }[] = [];
  error(message: string, err?: unknown): void {
    this.errors.push({ message, err });
  }
}
