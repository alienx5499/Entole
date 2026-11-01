import type { KeyHealth, KeyHealthCheck } from "../../application/ports.ts";
import type { GroqConfig } from "./groq-agent-model.ts";

// Listing models proves a key works without spending tokens.
const MODELS_URL = "https://api.groq.com/openai/v1/models";
const TIMEOUT_MS = 5_000;
const CACHE_MS = 60_000;

// Checks every key at once and keeps the answer for a minute, so the ops endpoint cannot be used
// to hammer Groq. Errors are reduced to a status or a word: Groq's error bodies are never passed on.
export class GroqKeyHealth implements KeyHealthCheck {
  private readonly http: typeof fetch;
  private readonly now: () => number;
  private cached?: { at: number; rows: Promise<KeyHealth[]> };

  constructor(private readonly cfg: Pick<GroqConfig, "apiKeys" | "fetch" | "now">) {
    this.http = cfg.fetch ?? fetch;
    this.now = cfg.now ?? Date.now;
  }

  check(): Promise<KeyHealth[]> {
    const t = this.now();
    if (!this.cached || t - this.cached.at >= CACHE_MS)
      this.cached = {
        at: t,
        rows: Promise.all(this.cfg.apiKeys.map((k, i) => this.one(k, i + 1))),
      };
    return this.cached.rows;
  }

  private async one(key: string, slot: number): Promise<KeyHealth> {
    const started = performance.now();
    const latencyMs = () => Math.round(performance.now() - started);
    try {
      const res = await this.http(MODELS_URL, {
        method: "GET",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { Authorization: `Bearer ${key}` },
      });
      await res.body?.cancel();
      return res.ok
        ? { slot, ok: true, status: res.status, latencyMs: latencyMs() }
        : {
            slot,
            ok: false,
            status: res.status,
            latencyMs: latencyMs(),
            error: `status ${res.status}`,
          };
    } catch (err) {
      const error = (err as Error).name === "TimeoutError" ? "timeout" : "network";
      return { slot, ok: false, status: 0, latencyMs: latencyMs(), error };
    }
  }
}
