# Entole architecture

Entole is a Bun and TypeScript monorepo with five backend packages, a test package, an API and a web app. This page covers what each module owns, the rules between them, the order in which money moves, and the choices that keep the money path safe when things run at the same time or fail halfway.

![Entole architecture: the modules, the services they call and how they connect](https://github.com/user-attachments/assets/70f98790-8afd-4197-92bb-6ed4d5c3fdf1)


## Modules

Each package under `packages/` has three folders. `domain` holds types and pure rules. `application` holds use cases and the ports (interfaces) they need. `infrastructure` holds the adapters that talk to PayPal, Channel3, Groq and Postgres. Each package exports everything through `src/index.ts`, and other modules import only from that index.

| Module | Owns |
| --- | --- |
| `packages/shared-kernel` | `Money` as integer cents in USD, the `Clock` and `SystemClock`, the `IdGenerator` and `CryptoIds`, and `readEnv`. It imports no other package. |
| `packages/mandate` | The `Mandate` and its terms, the SHA-256 digest, the state changes (fund, capture, close), and `checkProposal`. The use cases `createMandate`, `fundMandate`, `proposeOrder` and `closeMandate`, and the per-mandate lock. The `PaymentGateway`, `ProductSearch` and `MandateRepository` ports. The PayPal gateway, the Postgres mandate store and the database schema. |
| `packages/limit-order` | The watcher tick (`runWatcherTick`), price replay (`withReplayPrices`, `replayIndex`), savings, starting price tracking, and the Channel3 price tracker. |
| `packages/shopping` | The shortlist agent (`shortlistCandidates`), the agent tools, taste memory, the demo trap listing (`withDemoInjection`, `isDemoTrap`), Channel3 search and product details, the Groq model, and the Postgres taste store. |
| `packages/identity` | Sign-in (`signIn`), users and sessions, personal access tokens (`issueApiToken`, `authenticateApiToken`), Log in with PayPal, and the Postgres user, session and token stores. |
| `packages/testing` | In-memory fakes for every port, a live Postgres helper, and the architecture test. It is a dev dependency only. |
| `apps/api` | The `Bun.serve` server. `composition-root.ts` is the only place that builds real adapters and reads secrets. `http/` has the router, error mapping, validation, rate limits and JSON views. `routes/` has the auth and mandate routes. `jobs/limit-watch.ts` keeps the set of active limit orders, the cached price histories and the replay start times. |
| `apps/mcp` | A stdio MCP server built on `@modelcontextprotocol/sdk`. A thin HTTP client calls the API with a personal access token, and five tools (`create_limit_order`, `list_limit_orders`, `get_limit_order`, `cancel_limit_order`, `export_ap2_mandate`) validate input before any request. It imports no `@entole` package. |
| `apps/web` | The Next.js 16 app. `src/app` has the pages `/` and the three flow screens: `/mandates/new` (set your price), `/mandates/[id]/review` (review and approve) and `/mandates/[id]` (watch the price). `src/features/create-mandate` has the taste chips and the form. `src/features/review-mandate` has the terms summary, the kept and rejected items and the PayPal approve step. `src/features/live-mandate` has the mandate card, price chart, replay banner, action bar, timeline and "Why this one". `src/features/dashboard` is the `/dashboard` page: an AG Studio report over two tables, orders and price history, built in the browser from the existing list, detail and prices routes with at most four orders fetched at once, plus two custom Studio widgets (an AG Grid of orders that cross-filters the page and an AG Charts price history with the limit line) and an in-browser savings explainer agent that needs no model. `src/features/schedule` is the `/schedule` page: a Bryntum Scheduler with one row per order (or one order with `?order=<id>`), mapped in `schedule-data.ts` from the list and detail routes into the watch window, hold, check, capture, release and refund marks plus the next due check, and reloaded every 45 seconds while the tab is visible. `src/shared/ui` holds the stepper and the rejected list that more than one screen uses. `src/shared/api` is the typed client for `docs/API_CONTRACT.md`. |

Types that cross packages belong to mandate. `Candidate`, `ResolvedOffer`, `MandateTerms` and `Verdict` are in mandate's domain, and `ProductSearch` is in mandate's application ports, because a capture re-quotes through it.

### Package dependencies

| Package | Depends on | Test-only |
| --- | --- | --- |
| shared-kernel | nothing | |
| mandate | shared-kernel | testing |
| limit-order | mandate, shared-kernel | shopping, testing |
| shopping | mandate, shared-kernel | testing |
| identity | shared-kernel | testing |
| testing | every package above | |
| apps/api | identity, limit-order, mandate, shared-kernel, shopping | testing |
| apps/web | no `@entole` package; it talks to the API over HTTP | |
| apps/mcp | no `@entole` package; it talks to the API over HTTP | |

### Rules checked by a test

`packages/testing/test/architecture.test.ts` reads the source with plain file reads and a regex. It runs with `bun run check` and fails when:

- a file in `src/domain` imports anything other than its own domain folder, `@entole/shared-kernel` or `node:crypto`
- a file in `src/application` imports outside its own domain and application folders, or imports a bare module other than an `@entole/<package>` index
- a file in `src/infrastructure` reaches into another package by relative path (it may use `@entole/<package>` indexes, `node:*` and `bun`)
- any code imports a deep path such as `@entole/<package>/src/...`, imports its own package through `@entole/<own>`, or uses a relative path that leaves the package
- shared-kernel imports any `@entole` package
- production code in `packages/*/src` or `apps/api/src` imports `@entole/testing`
- the `dependencies` in the package.json files form a cycle
- anything in `apps/web/src` imports an `@entole` package
- a file name contains `utils` or `helpers`

The test also confirms that it scanned all three layers, more than 40 files and more than 100 imports, and that its rule rejects known bad imports.

The TypeScript build follows the same lines. Each package's `tsconfig.json` covers only `src` and references its runtime dependencies. The root `tsconfig.tests.json` typechecks all tests, so no package build depends on `@entole/testing`.

## AI clients and access tokens

Any MCP client can draft a limit order through `apps/mcp`, which sends `Authorization: Bearer ent_...` to the API. The token is a capability with a deliberately small reach: `requireCaller` in `apps/api/src/routes/auth.ts` accepts it on `/api/me`, listing, creating, reading and closing mandates, and every other route keeps using `requireUserId`, which reads only the session cookie. Creating a mandate produces a PayPal order, not a payment. The hold exists only after the user approves that order in PayPal and the browser return (with its session) or the webhook funds it, so an agent holding a token can propose and cancel but never move money. Tokens are stored as SHA-256 hashes in `api_tokens`, managed from the `/connect` page, and revoking one takes effect on its next request.

## The money flow

![The order of a limit order, from create to release](https://github.com/user-attachments/assets/ae13b947-5274-43ae-85fb-05cdba689901)

1. Create. `POST /api/mandates` validates the form. The limit is $1.00 to $5,000.00 and the window is 1 to 29 days (`validDays` in `apps/api/src/http/validation.ts`, `MAX_LIMIT_WINDOW_MS` in the mandate domain). The route builds limit terms in which the price limit and the budget are the same amount.

2. Shortlist. `shortlistCandidates` asks the Groq model to search Channel3 and submit up to 3 products, in at most 4 model steps. Each submitted item is re-fetched from Channel3 product details and run through `checkProposal` against a temporary funded copy of the terms. For a limit order, today's price above the limit is not a reason to reject, since the order waits for a drop. Duplicates are dropped, and the demo trap is always rejected. If nothing is kept, a plain Channel3 search fills the list through the same check. With no candidate at all, the route returns `422 no_candidates`. It also rejects an offer priced under half the median of the other sellers' prices for the same product, when at least two other sellers list it. For each kept product, the other shops in its Channel3 listing are re-quoted with the same options, cheapest listed first, and each one that passes the same checks and the outlier rule joins the candidate's shop list, up to 5 shops in all.

3. Sign at PayPal. `createMandate` builds the mandate with the shortlist inside its terms and computes the digest: SHA-256 over canonical JSON of the query, required options, brands, avoided words, kind, candidates (product id, merchant, options, baseline price, and the shop list when it has more than one shop, so older single-shop digests keep their bytes), price limit, budget, allowed merchants, expiry and the replay flag. It creates a PayPal Orders v2 order with intent `AUTHORIZE` for the budget, with the digest in `custom_id`, and returns the approval URL. The user approves the hold in PayPal.

4. Fund. PayPal sends the browser to `/api/paypal/return`. If there is no session, the user logs in first and comes back to the same URL. `fundMandate` checks that the order belongs to the mandate and that the mandate still awaits approval, then authorizes the order. The domain `fund` step refuses the authorization if its `custom_id` differs from the digest or its amount differs from the budget. In that case the new hold is voided before the error goes back. After funding, the route saves the taste, starts Channel3 price tracking for each candidate (not awaited, failures only go to the audit trail), and adds the mandate to the watch set.

   PayPal also sends a `CHECKOUT.ORDER.APPROVED` webhook to `POST /api/paypal/webhook`, so a buyer who approves and closes the tab before the redirect still ends up funded. The route checks the signature locally against PayPal's cert (SHA256withRSA over the CRC32 of the raw body), then `handlePayPalEvent` claims the event id in the `webhook_events` table and calls the same `fundMandate`. Whichever of the redirect and the webhook arrives second finds the mandate already funded and does nothing. Capture and void events only add a "PayPal confirmed ..." line to the audit trail. A claim is released when handling fails, so PayPal's retry is processed.

5. Watch. On each tick, `runWatcherTick` resolves each signed candidate's offer from the price source: live Channel3 product details, or the replayed history once a replay has started. The price compare is only a trigger. Every signed shop of every candidate is quoted, five at a time. The offers at or below the limit are proposed cheapest first, and the first one the check allows is bought, so the buy is the cheapest shop that passes. The audit entry names the shop and how many shops had a live quote. Replay plays one product's price history, so every shop of that product gets the same recorded price and the tie goes to the shop found at shortlist. `POST /api/mandates/:id/check-now` runs the same tick for one mandate.

   Holds past PayPal's 3-day honor period are renewed on the tick. `needsRenewal` is true once the honor period has lapsed, the authorization is still inside its 29 days and the window is still open; `renewMandateHold` then reauthorizes for the same amount under the lock (PayPal-Request-Id `reauthorize-<authorization id>`). A mandate renews once (`renewedAt`). If PayPal refuses, which the sandbox does for a second renewal with `REAUTHORIZATION_NOT_SUPPORTED`, the tick closes the mandate and voids the hold.

   Channel3 webhooks wake a check between ticks. `POST /api/channel3/webhook` (`apps/api/src/routes/channel3-webhook.ts`) verifies the Svix signature (`apps/api/src/http/svix.ts`), translates `offer.price.changed` and `offer.availability.changed` with `translateChannel3Event`, and asks `mandatesToWake` for the funded limit mandates that signed that product at the event's shop and for which the event matters (a price at or under the limit, or back in stock). For each one the `MandateCheckDispatcher` starts a check and `recordWakes` writes "Channel3 reported a price change at <shop>, checking now" to the audit trail. In `workflow` mode the dispatcher is `RenderWorkflowDispatcher`, which starts the `checkMandate` task with a 10 second start timeout and the idempotency key `c3:<event id>:<mandate id>`; in `timer` mode it is `InProcessDispatcher`, which runs the same check in the API without waiting. The route never waits for a check, so it answers inside Channel3's 15 second budget, and a failed start answers 503 so Svix retries. The audit entries are written after the starts; a failed write is logged and still answers 200, so Svix does not start the checks again. The event's price is never used to pay: the check re-quotes from Channel3 like every other proposal. The event id goes to the run as well, and once a Render run has finished a check, `recordCheckRun` writes a second entry with the same `eventId` and the run's `ctx.metadata.taskRunId`, so the schedule can show the alert as a "Price alert" mark linked to that Render run. Event ids over 128 characters are refused, since they end up in idempotency keys and the audit log.

   An event about a signed product and shop that does not wake the order is still recorded. `classifyOfferEvent` (`packages/limit-order/src/domain/offer-event.ts`) sorts each order into a wake, a note (a price or new offer above the limit, or no longer listed as in stock) or nothing, and `mandatesToWake` returns the wakes and the notes without reading any audit history, so nothing slows the path to the checks. After the checks start, `recordNotes` asks the repository for the order's `channel3_noted` entries from the last 6 hours (`recentNotes`, served by `audit_mandate_idx`), skips a note with the same product, shop and price or stock state, and writes one `channel3_noted` entry per remaining note, such as "Channel3 reported a price change at dyson.com: $889.99 (was $599.99), above your $582.00 limit. Still waiting." A note starts no check, no Render run and no PayPal or Channel3 call; it only makes the webhook visible on the order timeline and as a "Price update" mark on the schedule. Notes are best effort: wake and note entries are written independently, a repeat check that cannot read writes the notes anyway, and a failed note write is logged while the delivery still answers 200, so a partial failure can lose a note, and only a repeat check that could not read can repeat one.

   When a check buys nothing and the best quote sits above the limit by 5% or less, `proposeCheckNearLimit` (`packages/limit-order/src/application/propose-check.ts`) has the watcher propose an extra check on its own (`by: "auto"`). It runs under the same per-mandate lock, because ticks for one order can overlap (the hourly run, a webhook check, the API timer). It proposes nothing when a proposal or accepted check is already ahead of now, or when it made one for that order in the last 6 hours. The time is 15 minutes ahead, clamped to one minute before `latestCheckAt` (the earlier of the window's end and the hold's expiry), and none is made with less than 5 minutes of room. The proposal goes through the same `proposeCheck` command an AI client uses and changes nothing until the buyer accepts it.

6. Propose. `proposeOrder` takes the lock for the mandate, reads it again from the store, and re-quotes the exact product, merchant and options. `resolveOffer` takes only that shop's offer that is in stock and not listed as used (an offer with no stated condition counts as new, as in Channel3's own search); with none, the check blocks with `product_unavailable`.

7. Check. `checkProposal` returns allow or block with reasons. It blocks when the mandate is not funded, closed or exhausted, when the mandate or the hold has expired, when the product is gone, or for the wrong merchant, an offer link that is not https or leads somewhere other than the merchant's own domain or Channel3's tracked redirect, wrong brand, an avoided word in the title, a product not on the signed list (any signed shop of that exact product and options is accepted), missing required options, an offer that is out of stock (`out_of_stock`) or listed as used (`not_new`), a price above the limit, or a price above the remaining budget. A block goes to the audit trail with its reasons.

8. Capture. On allow, the gateway captures the re-quoted price. A limit mandate buys once, so the capture is sent with `final_capture=true` and PayPal releases the rest of the hold in the same call; `note_to_payer` says what was bought. `recordCapture` checks the amount against the remaining budget again and marks a limit mandate exhausted. If PayPal fails, the audit trail records "Payment provider error, nothing was charged" and nothing changes.

9. Release. After a capture, the watcher closes the mandate at once. `closeMandate` voids the authorization first and saves after that, so a failed void leaves the mandate open for a retry. A mandate that expires with no buy is closed and voided the same way on the next tick. The user can also press "Close and release hold" while the mandate is funded or exhausted.

"Simulate compromised agent" (`POST /api/mandates/:id/simulate`) sends the planted listing through the same `proposeOrder`. The button is enabled only while the mandate is funded, and the check blocks the listing with `not_a_candidate`. After a capture the mandate is closed, so the check would only report `closed`.

## Concurrency and idempotency

| Concern | What the code does |
| --- | --- |
| Two proposals at once (a timer tick and check-now, or the API and the workflow worker) | `withMandateLock` runs work per mandate id under a Postgres advisory lock, so it holds across processes. `proposeOrder` re-reads the mandate inside the lock, so the second proposal sees it exhausted and is blocked. |
| Capture above what is left | `checkProposal` blocks a price above the remaining budget, and `recordCapture` checks again before saving. |
| A capture retried after a timeout or a failed save | A limit mandate uses the PayPal-Request-Id `<mandate id>-capture`, so a retry replays the first capture instead of charging again. |
| Retried PayPal calls | Order creation uses `order-<mandate id>`, authorization uses `authorize-<order id>`, reauthorization uses `reauthorize-<authorization id>`, and void uses `void-<authorization id>` as the PayPal-Request-Id. |
| A Channel3 webhook delivered twice | The API remembers event ids for 24 hours (`RecentIds`) and answers a repeat with `duplicate: true`. In `workflow` mode a redelivery after a restart reaches Render with the same idempotency key, `c3:<event id>:<mandate id>`, and Render returns the run it already started. Render scopes the key to a workflow version, so a deploy between a delivery and its retry can start a second run; the fixed capture request id makes that harmless. A dispatch that failed is not remembered, so Svix's retry starts it again; the mandate lock and the fixed capture request id keep that from capturing twice. |
| A hold placed on a mandate that cannot take it | `fundMandate` refuses a mandate that is not awaiting approval before it authorizes, and voids the hold if the digest or amount check fails. |
| Reloading the PayPal return URL | A funded or exhausted mandate redirects to its page without an error. |
| A PayPal webhook delivered twice | The event id is the primary key of `webhook_events`, so the second delivery is ignored. |
| A void that keeps failing | Each failure increments `voidAttempts`. At 3 failures `closeMandate` writes one audit entry and throws `ReleaseFailed` (`502 release_failed`), and the watcher stops retrying that mandate. A void of a hold that PayPal reports as already voided or expired counts as success. |
| Closing twice | A closed mandate returns early, and a void runs only when money is left and the mandate is not already voided. |
| Overlapping ticks | `LimitWatch.tick` skips a tick while the previous one is still running. One failing mandate is audited and does not stop the others. |
| Hung upstream calls | Every adapter fetch has a timeout: 15 seconds for PayPal and Channel3, 30 seconds for Groq. |
| Slow mandate creation | `Bun.serve` has `idleTimeout: 120`, because creating a mandate runs several Groq and Channel3 calls in a row. |
| An AI client retrying a write | `POST /api/mandates`, `/close` and `/schedule/propose` honour the `Idempotency-Key` the generated SDK sends (`apps/api/src/http/idempotency.ts`, table `idempotency_keys`). A key is claimed per caller with a 5 minute lease, longer than Bun's 120 second idle timeout, so a live request never runs twice and a crashed one frees its key; the answer is then kept for 24 hours and replayed with `Idempotent-Replayed: true`. A retry while the first runs is `409 idempotency_in_progress`, the same key with another body or route is `422 idempotency_key_reused`, and a request that throws frees its key. Each claim carries a random `claim_id`, and the answer is saved or the key freed only under it, so a request that outlived its lease cannot touch the claim that replaced it. |
| Abuse | Create is limited to 10 per minute per user, and to 30 per user and 500 in total per 24 hours, counted from the database. Check-now, replay start and simulate share a limit of 60 per minute per mandate. The PayPal webhook is limited to 30 per minute per forwarded IP and 300 per minute in total. The Channel3 webhook has its own limiters: 600 verified deliveries a minute in total, and a separate 30 a minute per IP for deliveries with a bad or stale signature, so forgeries never use up PayPal's bucket or the real deliveries' window. |

The per-mandate lock is `PostgresMandateLock` (`packages/mandate/src/infrastructure/postgres/mandate-lock.ts`): a transaction-scoped `pg_advisory_xact_lock(hashtext(mandateId))` on a small pool of its own, wired in `productionContainer`, which both the API and the workflow worker build. Postgres releases it at commit or rollback, so a throw, a lock wait over 30 seconds or a lost connection all free it. Tests use `InMemoryMandateLock`. The replay state and the per-minute rate limits still live in process memory, so the API runs as one instance.

## The Neon cost guard

The database is Neon Postgres, which suspends compute when it is idle and counts compute hours. The API keeps database work away from the timer when nothing needs it.

- `LimitWatch` keeps the ids of active limit orders in memory. It reads them from the database once at boot. After that, funding, closing and the ticks keep the set current.
- When the set is empty, a tick does no database work at all, so Neon can sleep.
- `WATCHER_MODE` picks who runs the watcher. In `timer` mode (the default) the API runs `LimitWatch.tick`. In `workflow` mode the API starts no timer, and a Render Workflows service runs the tasks in `apps/api/src/workflows`. `watchLimitOrders` reads the funded limit mandates from the database, then starts one `checkMandate` run per mandate with `ctx.run`. Each child calls `runWatcherTick` through the same `productionContainer`, so the buy still goes through the check. A failed child is retried (up to 2 times), then counted, and does not stop the others. `checkMandate` times out after 120 seconds and `watchLimitOrders` after 900. An hourly Render cron job (`trigger.ts`) starts the parent task, because Workflows has no schedule of its own. Channel3 webhooks start `checkMandate` directly from the API for the orders an event affects, so the hourly run is the safety net for events that never arrive. Workflow runs use live prices only, since price replays live in the API's memory.
- `WATCH_INTERVAL_MIN` defaults to 60, and `render.yaml` sets it to 60. Each tick wakes Neon only while at least one limit order is open, and a slow tick does not hurt the demo, which uses replay and check-now.
- `/api/health` does no database work, so an uptime pinger keeps the Render instance awake without waking Neon.
- Price histories for the chart are fetched once per mandate and cached in memory.
- The schema is created by one idempotent `migrate` at boot, from `packages/mandate/src/infrastructure/postgres/schema.sql`. The identity and shopping stores use the same schema.
