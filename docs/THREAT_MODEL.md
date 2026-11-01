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

Buyer, AI agent (the Groq model), a malicious listing or seller, prompt injection in product text, an MCP client holding a token, a network attacker, and someone who spoofs PayPal or Channel3 webhooks.

## Threats and controls

### The model is steered into a bad buy (prompt injection, malicious listing)

The model can only suggest. It never sets a price, never calls PayPal and never captures. Its output is a list of product ids, merchants and options. Every suggestion is re-fetched from Channel3 and run through `checkProposal`.

- `checkProposal` (`packages/mandate/src/domain/check.ts`) is plain code. It blocks on status, expiry of the mandate and of the hold, merchant allow list, a link that is not https or not on the merchant's own domain or Channel3's redirect host, brand, avoided words, a product or shop that is not on the signed shortlist (`not_a_candidate`), missing required options, an offer that is out of stock or listed as used, a price above the limit, and a price above the remaining budget.
- The price is never passed in. `proposeOrder` (`packages/mandate/src/application/propose-order.ts`) re-quotes the exact product, merchant and options from Channel3 at that moment, and the check runs on that price. The re-quote takes only the shop's offer that is in stock and not listed as used (`resolveOffer` in `packages/shopping/src/infrastructure/channel3/channel3-search.ts`), so a price drop on a used or sold-out listing cannot be bought.
- The check runs under `withMandateLock` (`packages/mandate/src/application/mandate-lock.ts`). In production the lock is a Postgres advisory lock per mandate id (`packages/mandate/src/infrastructure/postgres/mandate-lock.ts`), shared by the API and the Render Workflows worker, so it holds across processes and across the overlap of a deploy. The mandate is read again inside the lock, so two proposals at once cannot capture more than what is left, and a close cannot overwrite a capture saved by another process. `recordCapture` (`packages/mandate/src/domain/transitions.ts`) checks the budget a second time before saving.
- The too-cheap rule is in the shortlist, not in `checkProposal`. `priceOutlierDetail` (`packages/shopping/src/domain/price-outlier.ts`) rejects an offer under half the median price, using other sellers of the same product, or similar items in the same search when there are fewer than two peers. It runs when shops are signed (`packages/shopping/src/application/shortlist-candidates.ts`), so a suspiciously cheap shop never enters the signed list.
- The planted demo listing is never signable (`isDemoTrap` in `packages/shopping/src/application/demo-injection.ts`, used in `shortlist-candidates.ts`). The "Simulate compromised agent" route sends it through the real `proposeOrder`, and the check blocks it with `not_a_candidate`.

### The terms are changed after the buyer approves

The mandate digest is SHA-256 over canonical JSON of the terms, including the signed shortlist, limit, budget, expiry and the replay flag (`packages/mandate/src/domain/mandate.ts`). It goes into the PayPal order as `custom_id` (`packages/mandate/src/infrastructure/paypal/paypal-gateway.ts`). When PayPal returns the authorization, `fund` (`packages/mandate/src/domain/transitions.ts`) refuses it if `custom_id` differs from the digest or the amount differs from the budget. `fundMandate` (`packages/mandate/src/application/fund-mandate.ts`) then voids the new hold.

### The hold is used for more than the limit

There is one `AUTHORIZE` hold, for the limit amount. A limit mandate captures once with `final_capture=true` (`propose-order.ts`, `paypal-gateway.ts`), so PayPal releases the rest of the hold in the same call, and the check caps the capture at the remaining budget. The window is 1 to 29 days. Past PayPal's 3-day honor period the watcher reauthorizes once, for the same amount and never more (`packages/mandate/src/application/renew-hold.ts`); if PayPal refuses, the mandate closes and the hold is voided. `closeMandate` (`packages/mandate/src/application/close-mandate.ts`) voids the rest of the hold first and saves after, so a failed void leaves the mandate open for a retry. After 3 failed voids it raises `release_failed` and the watcher stops retrying.

### Double charge on retry

PayPal calls carry a `PayPal-Request-Id`: `order-<mandate id>`, `authorize-<order id>`, `<mandate id>-capture`, `reauthorize-<authorization id>`, `void-<authorization id>` and `refund-<mandate id>`. A retry after a timeout replays the first result. `refundMandate` (`packages/mandate/src/application/refund-mandate.ts`) also returns early when the mandate already has a refund, under the same lock.

### Forged or replayed PayPal webhooks

`apps/api/src/routes/webhooks.ts` accepts no event until its signature checks out locally (`PayPalSignatureVerifier` in `packages/mandate/src/infrastructure/paypal/paypal-signature.ts`): SHA256withRSA over `transmission id|transmission time|webhook id|CRC32 of the raw body`, with `paypal-auth-algo` pinned to `SHA256withRSA`. The cert comes from `paypal-cert-url`, which is fetched only over https from a `paypal.com` host, so the TLS connection to PayPal vouches for it; a cert outside its validity dates is refused, and certs are cached by URL. A request missing any signature header is rejected without a fetch, and so is one whose `paypal-transmission-time` is more than 15 minutes from now (the replay window), a body over 32 KB, or a client over the webhook rate limit (30 a minute per forwarded IP, 300 a minute in total). If PayPal fails to serve the cert, the route answers 500 and PayPal retries. With no `PAYPAL_WEBHOOK_ID`, the route answers 503. Each event id is claimed in the `webhook_events` table (`packages/mandate/src/infrastructure/postgres/mandate-repository.ts`), so a repeat is ignored, and the claim is released if handling fails so PayPal's retry works. A webhook can only fund a mandate whose PayPal order matches, through the same `fundMandate` checks.

### Forged, replayed or repeated Channel3 webhooks

`POST /api/channel3/webhook` (`apps/api/src/routes/channel3-webhook.ts`) takes no session; the Svix signature is the authentication. `verifySvix` (`apps/api/src/http/svix.ts`) computes HMAC-SHA256 over `svix-id.svix-timestamp.raw body` with the endpoint secret, compares in constant time, accepts any of the listed `v1,` signatures so a rotated key still verifies, and refuses a timestamp more than five minutes from now (the replay window). The secret is decoded once at boot, and a secret that is not a real `whsec_` key of at least 24 bytes stops the API instead of becoming an empty, forgeable key. With no `CHANNEL3_WEBHOOK_SECRET` the route answers 503.

- Missing signature headers are a 400. A bad or stale signature is a 401 and counts against its own limiter, 30 a minute per IP (`channel3Forged` in `apps/api/src/http/router.ts`), separate from PayPal's webhook limiter and from the 600 a minute that verified deliveries share, so a flood of forgeries cannot block PayPal's events or Channel3's real ones.
- A verified event that can never be read is a 400 with `webhook-delivery: abort-message`, so Svix stops retrying it. Both Svix (docs.svix.com/retries) and Channel3 (channel3.ai/docs/product-subscription-webhooks) document that header.
- Event ids are remembered for 24 hours (`apps/api/src/http/recent-ids.ts`), so a repeat is skipped. In `workflow` mode each check is started on Render with the idempotency key `c3:<event id>:<mandate id>`, so a redelivery after an API restart returns the run already started instead of starting another (Render scopes the key to a workflow version, so a deploy in between can start a second run, which the fixed capture request id makes harmless). Event ids over 128 characters are refused with the abort header, since they end up in those keys and in the audit log.
- A webhook can wake a check but cannot buy. It names a product and a price; the price is never used. The check re-quotes from Channel3 and runs `checkProposal` under the lock like every other proposal. The worst a forged event could do, if it passed, is cost one Channel3 quote per affected order. Only orders that signed both the product and the event's shop are woken, so events from other shops cost nothing.
- The wake audit entries are written after the checks start. If that write fails it is logged and the delivery still answers 200, so Svix does not retry and start the checks a second time.

### Forged PayPal shipping callbacks

`POST /api/paypal/shipping-callback` (`apps/api/src/routes/shipping-callback.ts`) takes the same signature check, over `transmission id|transmission time|CRC32 of the raw body` since callbacks carry no webhook id, and the same 15 minute window. A verified callback still gets an answer only when its order belongs to the mandate named in the callback URL and is awaiting approval; every other case is the same 404. The worst a forged callback could do, if it passed, is add a `ship_to_refused` audit line; it cannot fund, capture or change an order. The route has a service-wide cap of 600 a minute and no per-IP cap, since PayPal's callback servers are shared by every buyer.

### The watcher proposes checks on its own

When a check finds the best quote above the limit by 5% or less, the watcher may propose an extra check (`proposeCheckNearLimit` in `packages/limit-order/src/application/propose-check.ts`). It reads the audit and writes the proposal under the per-mandate lock, so overlapping ticks for one order cannot both propose. It proposes at most once every 6 hours per order, never when a proposal or accepted check is already ahead, and only at a time after now and before `latestCheckAt`, the earlier of the signed window's end and the hold's expiry. A proposal moves no money and changes nothing until the buyer accepts it with a session; the API checks the time again on accept (`checkTimeRefusal` in `packages/mandate/src/domain/transitions.ts`).

### An MCP client with a token tries to spend

A token can reach seven routes only: `GET /api/me`, `GET /api/mandates`, `POST /api/mandates`, `GET /api/mandates/:id`, `GET /api/mandates/:id/ap2`, `POST /api/mandates/:id/close` and `POST /api/mandates/:id/schedule/propose`. A proposed check does nothing until the buyer accepts it in the browser. These use `requireCaller` (`apps/api/src/routes/auth.ts`). Every other route uses `requireUserId`, which reads only the session cookie. So a token cannot approve, fund, refund, simulate, start replay, check now or manage tokens. Creating a mandate makes a PayPal order, not a payment. Money moves only after the buyer approves in PayPal. A bearer header that does not authenticate is a 401 and never falls back to the cookie. A client that retries a create, close or propose with the same `Idempotency-Key` gets the first answer back instead of a second order (`apps/api/src/http/idempotency.ts`); keys are scoped to the caller, so one user's key can never replay another user's answer, and the same key with another body is refused with `422 idempotency_key_reused`. Each claim gets its own random `claim_id`, and the stored answer is written or the key freed only under that id, so a request that outlived its 5 minute lease cannot overwrite or free the claim of the request that took the key over. Proposals are also limited to 10 a minute per owner across all their orders.

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
- The webhook rate limits key on the first `X-Forwarded-For` entry, which a client can set. The total caps (300 a minute for PayPal, 600 a minute for verified Channel3 deliveries) still hold.
- The Channel3 event id memory lives in process and resets on restart; Render's idempotency key covers redeliveries that reach a restarted API, and the lock and the fixed capture request id cover the rest.
- In `workflow` mode the internet-facing API holds `RENDER_API_KEY` so Channel3 webhooks can start `checkMandate` runs. Render has no scoped keys, so that key reaches the whole Render account, not just the workflow. It is set with `sync: false` (never in the repo or the Blueprint), read once in the composition root and never logged. Revoke it after judging, and keep the services in a separate Render workspace where possible.
- Personal access tokens have no expiry or scopes beyond the fixed seven routes. They are bearer secrets. Anyone holding one can draft and cancel that user's orders until it is revoked.
- No audit of the Next.js and Bun dependencies beyond the lockfile, and no external penetration test.
