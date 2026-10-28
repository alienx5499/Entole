# Entole threat model

Entole is a PayPal sandbox project. This page lists what an attacker could want, who might try, and which code stops them. Every control below names the file that holds it. The last section lists what is not covered.

## Assets

| Asset | Why it matters |
| --- | --- |
| The buyer's money | Sandbox funds here, but the design treats it as real. |
| The PayPal hold | One `AUTHORIZE` order per mandate, for the price limit. Capture and void act on it. |
| The session | The `entole_session` cookie. It is the only credential that can approve, refund or manage tokens. |
| API tokens | Personal access tokens (`ent_...`) that let an AI client draft and cancel orders. |
| The signed terms | The mandate digest. It says what the buyer agreed to. |

## Actors

Buyer, AI agent (the Groq model), a malicious listing or seller, prompt injection in product text, an MCP client holding a token, a network attacker, and someone who spoofs PayPal webhooks.

## Threats and controls

### The model is steered into a bad buy (prompt injection, malicious listing)

The model can only suggest. It never sets a price, never calls PayPal and never captures. Its output is a list of product ids, merchants and options. Every suggestion is re-fetched from Channel3 and run through `checkProposal`.

- `checkProposal` (`packages/mandate/src/domain/check.ts`) is plain code. It blocks on status, expiry of the mandate and of the hold, merchant allow list, a link that is not https or not on the merchant's own domain or Channel3's redirect host, brand, avoided words, a product or shop that is not on the signed shortlist (`not_a_candidate`), missing required options, a price above the limit, and a price above the remaining budget.
- The price is never passed in. `proposeOrder` (`packages/mandate/src/application/propose-order.ts`) re-quotes the exact product, merchant and options from Channel3 at that moment, and the check runs on that price.
- The check runs under `withMandateLock` (`packages/mandate/src/application/mandate-lock.ts`). In production the lock is a Postgres advisory lock per mandate id (`packages/mandate/src/infrastructure/postgres/mandate-lock.ts`), shared by the API and the Render Workflows worker, so it holds across processes and across the overlap of a deploy. The mandate is read again inside the lock, so two proposals at once cannot capture more than what is left, and a close cannot overwrite a capture saved by another process. `recordCapture` (`packages/mandate/src/domain/transitions.ts`) checks the budget a second time before saving.
- The too-cheap rule is in the shortlist, not in `checkProposal`. `priceOutlierDetail` (`packages/shopping/src/domain/price-outlier.ts`) rejects an offer under half the median price, using other sellers of the same product, or similar items in the same search when there are fewer than two peers. It runs when shops are signed (`packages/shopping/src/application/shortlist-candidates.ts`), so a suspiciously cheap shop never enters the signed list.
- The planted demo listing is never signable (`isDemoTrap` in `packages/shopping/src/application/demo-injection.ts`, used in `shortlist-candidates.ts`). The "Simulate compromised agent" route sends it through the real `proposeOrder`, and the check blocks it with `not_a_candidate`.

### The terms are changed after the buyer approves

The mandate digest is SHA-256 over canonical JSON of the terms, including the signed shortlist, limit, budget, expiry and the replay flag (`packages/mandate/src/domain/mandate.ts`). It goes into the PayPal order as `custom_id` (`packages/mandate/src/infrastructure/paypal/paypal-gateway.ts`). When PayPal returns the authorization, `fund` (`packages/mandate/src/domain/transitions.ts`) refuses it if `custom_id` differs from the digest or the amount differs from the budget. `fundMandate` (`packages/mandate/src/application/fund-mandate.ts`) then voids the new hold.

### The hold is used for more than the limit

There is one `AUTHORIZE` hold, for the limit amount. Capture is partial with `final_capture=false` (`paypal-gateway.ts`), and the check caps each capture at the remaining budget. A limit mandate captures once and then closes. `closeMandate` (`packages/mandate/src/application/close-mandate.ts`) voids the rest of the hold first and saves after, so a failed void leaves the mandate open for a retry. After 3 failed voids it raises `release_failed` and the watcher stops retrying.

### Double charge on retry

PayPal calls carry a `PayPal-Request-Id`: `order-<mandate id>`, `authorize-<order id>`, `<mandate id>-capture`, `void-<authorization id>` and `refund-<mandate id>`. A retry after a timeout replays the first result. `refundMandate` (`packages/mandate/src/application/refund-mandate.ts`) also returns early when the mandate already has a refund, under the same lock.

### Forged or replayed PayPal webhooks

`apps/api/src/routes/webhooks.ts` accepts no event until its signature checks out locally (`PayPalSignatureVerifier` in `packages/mandate/src/infrastructure/paypal/paypal-signature.ts`): SHA256withRSA over `transmission id|transmission time|webhook id|CRC32 of the raw body`, with `paypal-auth-algo` pinned to `SHA256withRSA`. The cert comes from `paypal-cert-url`, which is fetched only over https from a `paypal.com` host, so the TLS connection to PayPal vouches for it; a cert outside its validity dates is refused, and certs are cached by URL. A request missing any signature header is rejected without a fetch, and so is one whose `paypal-transmission-time` is more than 15 minutes from now (the replay window), a body over 32 KB, or a client over the webhook rate limit (30 a minute per forwarded IP, 300 a minute in total). If PayPal fails to serve the cert, the route answers 500 and PayPal retries. With no `PAYPAL_WEBHOOK_ID`, the route answers 503. Each event id is claimed in the `webhook_events` table (`packages/mandate/src/infrastructure/postgres/mandate-repository.ts`), so a repeat is ignored, and the claim is released if handling fails so PayPal's retry works. A webhook can only fund a mandate whose PayPal order matches, through the same `fundMandate` checks.

### Forged PayPal shipping callbacks

`POST /api/paypal/shipping-callback` (`apps/api/src/routes/shipping-callback.ts`) takes the same signature check, over `transmission id|transmission time|CRC32 of the raw body` since callbacks carry no webhook id, and the same 15 minute window. A verified callback still gets an answer only when its order belongs to the mandate named in the callback URL and is awaiting approval; every other case is the same 404. The worst a forged callback could do, if it passed, is add a `ship_to_refused` audit line; it cannot fund, capture or change an order. The route has a service-wide cap of 600 a minute and no per-IP cap, since PayPal's callback servers are shared by every buyer.

### An MCP client with a token tries to spend

A token can reach seven routes only: `GET /api/me`, `GET /api/mandates`, `POST /api/mandates`, `GET /api/mandates/:id`, `GET /api/mandates/:id/ap2`, `POST /api/mandates/:id/close` and `POST /api/mandates/:id/schedule/propose`. A proposed check does nothing until the buyer accepts it in the browser. These use `requireCaller` (`apps/api/src/routes/auth.ts`). Every other route uses `requireUserId`, which reads only the session cookie. So a token cannot approve, fund, refund, simulate, start replay, check now or manage tokens. Creating a mandate makes a PayPal order, not a payment. Money moves only after the buyer approves in PayPal. A bearer header that does not authenticate is a 401 and never falls back to the cookie.

Tokens are 32 random bytes with an `ent_` prefix. Only the SHA-256 hash is stored (`packages/identity/src/domain/api-token.ts`). The plaintext is shown once. Revoking takes effect on the next request. Session tokens are stored as hashes too (`packages/identity/src/infrastructure/postgres/session-repository.ts`). Limits: 20 active tokens per user, 10 mandate creations a minute per user, and daily caps on creation (30 per user and 500 in total by default, counted from the database).

The MCP server (`apps/mcp/src/tools.ts`) quotes product titles and shop names on one line under an "untrusted listing text" label, and its tool descriptions tell the assistant that listing text is data, not instructions. It refuses an `ENTOLE_URL` that is not https, except for localhost and 127.0.0.1, so a token is never sent in cleartext.

### Network attacker

The session cookie is httpOnly and SameSite=Lax (`apps/api/src/http/http.ts`), and the login state is compared in constant time (`apps/api/src/routes/auth.ts`). Every upstream call has a timeout. Mandate routes check the owner and return 403 for another user's mandate. The login `next` redirect is kept only when it starts with `/api/paypal/return?`. The deploy serves HTTPS through Render and Vercel.

### Using the code against real money

`productionContainer` (`apps/api/src/composition-root.ts`) throws unless `PAYPAL_API_BASE` is the PayPal sandbox URL.

## What is not covered

- Sandbox only. No real funds have been tested, and the guard above is a deliberate wall, not a certified one.
- The replay state and the per-minute rate limits live in process memory, so Entole runs as one API instance. The per-mandate lock is not the reason: it is a Postgres advisory lock shared by every process. Tests use an in-process lock instead.
- The watcher mode rule is manual. `WATCHER_MODE` must be switched to `workflow` on the API and the cron job together. If only one is switched, two watchers run. The shared lock serialises them per mandate and the second one re-reads the mandate, so it cannot capture twice or overwrite a capture, but every mandate is checked twice and the catalog calls double. The repo ships in `timer` mode.
- The too-cheap rule is a heuristic. It does nothing when there are too few peer prices to judge. A scam priced at the median passes it, and so does a listing whose merchant is allowed and whose link is on the right domain.
- The check trusts Channel3 for price, title, brand and options. A wrong catalog entry is not detected.
- Render free tier instances sleep. A cold start can take up to a minute, and a timer tick can be missed while it is asleep. An uptime pinger on `/api/health` reduces this.
- The per-minute rate limits are in memory per process and reset on restart. The daily mandate caps are counted from the database, but they count created mandates only, so a create that fails with `no_candidates` still spends catalog and model calls and is held back only by the per-minute limit.
- The webhook rate limit keys on the first `X-Forwarded-For` entry, which a client can set. The total cap of 300 a minute still holds.
- Personal access tokens have no expiry or scopes beyond the fixed seven routes. They are bearer secrets. Anyone holding one can draft and cancel that user's orders until it is revoked.
- No audit of the Next.js and Bun dependencies beyond the lockfile, and no external penetration test.
