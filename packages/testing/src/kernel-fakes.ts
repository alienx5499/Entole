import type { Clock, IdGenerator } from "@entole/shared-kernel";

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
