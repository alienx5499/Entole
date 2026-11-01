"use client";

import { type FormEvent, useEffect, useState } from "react";
import type { ApiTokenView } from "@/shared/api";
import { createToken, listTokens, revokeToken } from "@/shared/api";
import { CurveLoader, CurveSpinner } from "@/shared/ui";
import { CopyBlock } from "./CopyBlock";
import s from "./connect-ai.module.css";
import { MAX_TOKEN_NAME } from "./limits";

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

// The MCP client config for this deployment; the fresh token is filled in when there is one.
const configFor = (origin: string, token: string) =>
  JSON.stringify(
    {
      mcpServers: {
        entole: {
          command: "bun",
          args: ["/path/to/Entole/apps/mcp/src/main.ts"],
          env: { ENTOLE_URL: origin, ENTOLE_TOKEN: token },
        },
      },
    },
    null,
    2,
  );

/** Personal access tokens for MCP clients: create one, see it once, revoke any. */
export function ConnectAi() {
  const [tokens, setTokens] = useState<ApiTokenView[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [name, setName] = useState("Claude Desktop");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<{ name: string; token: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [origin, setOrigin] = useState("https://entole.vercel.app");

  // A 401 sends the browser to `/?login=1` inside the client.
  useEffect(() => {
    setOrigin(window.location.origin);
    listTokens()
      .then(setTokens)
      .catch(() => setFailed(true));
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const created = await createToken(name.trim());
      setFresh({ name: name.trim(), token: created.token });
      setTokens(await listTokens());
    } catch {
      setError(
        `Could not create the token. Check the name (1 to ${MAX_TOKEN_NAME} characters) and try again.`,
      );
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    setRevoking(id);
    setError(null);
    try {
      await revokeToken(id);
      setTokens(await listTokens());
    } catch {
      setError("Could not revoke the token. Reload and try again.");
    } finally {
      setRevoking(null);
      setConfirming(null);
    }
  }

  if (failed) return <p role="alert">Could not load your tokens. Reload to retry.</p>;
  if (!tokens) return <CurveLoader title="Loading your tokens" />;

  const live = tokens.filter((t) => !t.revokedAt);

  return (
    <section className={s.wrap} aria-labelledby="connect-title">
      <h1 id="connect-title">Connect an AI</h1>
      <p className={s.lede}>
        Any AI assistant that speaks MCP can draft a limit order for you. It cannot spend a cent:
        nothing is held until you approve the order yourself in PayPal.
      </p>

      <form className={`card ${s.create}`} onSubmit={create}>
        <label>
          Token name
          <input
            required
            maxLength={MAX_TOKEN_NAME}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={creating || !name.trim()}>
          {creating && <CurveSpinner />}
          {creating ? "Creating" : "Create token"}
        </button>
      </form>

      {error && (
        <p className="error-note" role="alert">
          {error}
        </p>
      )}

      {fresh && (
        <div className={`card ${s.fresh}`} role="status">
          <h2>Your new token for {fresh.name}</h2>
          <p>Copy it now. Entole keeps only a hash, so it will not be shown again.</p>
          <CopyBlock label="token" text={fresh.token} />
        </div>
      )}

      <h2>Add Entole to your AI client</h2>
      <p>
        Paste this into your MCP client config (for Claude Desktop, Settings, Developer, Edit
        Config). Point the path at your copy of the Entole repo and run it with Bun.
      </p>
      <CopyBlock label="config" text={configFor(origin, fresh?.token ?? "ent_your_token_here")} />

      <h2>Your tokens</h2>
      {live.length === 0 ? (
        <p className="card">No active tokens.</p>
      ) : (
        <ul className={s.list}>
          {live.map((t) => (
            <li key={t.id} className={`card ${s.row}`}>
              <span className={s.name}>{t.name}</span>
              <span className={s.meta}>
                created {day(t.createdAt)} ·{" "}
                {t.lastUsedAt ? `last used ${day(t.lastUsedAt)}` : "never used"}
              </span>
              <span className={s.actions}>
                {confirming === t.id ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-danger"
                      disabled={revoking === t.id}
                      onClick={() => revoke(t.id)}
                    >
                      {revoking === t.id ? "Revoking" : "Yes, revoke"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={revoking === t.id}
                      onClick={() => setConfirming(null)}
                    >
                      Keep
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    aria-label={`Revoke ${t.name}`}
                    onClick={() => setConfirming(t.id)}
                  >
                    Revoke
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
