// Server-side error log for failures that are handled and must not reach the caller.
export interface Logger {
  error(message: string, err?: unknown): void;
}
