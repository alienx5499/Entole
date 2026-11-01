# Entole API contract

This is the contract between `apps/api` and `apps/web`. The routes live in `apps/api/src/routes`.

`docs/openapi.yaml` is the machine-readable OpenAPI spec for the bearer-token routes.

The base path is `/api`. The web app calls relative `/api/...` URLs, and the Next.js rewrite forwards them to the API on Render. Bodies are JSON. Money is always a decimal string in USD, for example `"159.00"`. Dates are ISO strings.

## Errors

An error returns `{ "error": string }`, sometimes with more fields, such as `field` or `rejected`.

| Status | Codes |
| --- | --- |
| 400 | `invalid_json`, `invalid_field` (with `field`), `invalid_request`, `invalid_state` and `missing_code` (login callback), `invalid_return` (PayPal return), `invalid_event`, `invalid_signature` and `stale_transmission` (PayPal webhook), `invalid_callback` and `stale_transmission` (PayPal shipping callback), `missing_signature_headers` and `invalid_event` (Channel3 webhook), `invalid_idempotency_key` |
| 401 | `unauthorized` (no session, the session expired, or the bearer token is unknown or revoked), `invalid_signature` (PayPal shipping callback and Channel3 webhook) |
| 403 | `forbidden` (the mandate belongs to someone else) |
| 404 | `not_found` (unknown route or mandate, or a shipping callback for an order that is not awaiting approval) |
| 405 | `method_not_allowed` (the path exists, the method does not) |
| 413 | `body_too_large` (dashboard assistant turn over 256,000 characters, or a webhook body over 32 KB) |
| 409 | `too_many_tokens` (20 active tokens), `funding_mismatch` (digest or amount differs from the mandate), `invalid_state`, `not_replay`, `not_funded`, `not_demo`, `not_watching` and `no_pending_proposal` (schedule), `idempotency_in_progress` (with `Retry-After: 2`) |
| 422 | `no_candidates` (with `rejected`), `no_price_history`, `check_in_past` and `past_valid_until` (schedule), `idempotency_key_reused`; the shipping callback answers 422 in PayPal's own error shape instead |
| 429 | `rate_limited` (our limit), `daily_limit_reached` and `service_daily_limit_reached` (mandate creation caps), `upstream_rate_limited` (Groq) |
| 500 | `internal_error` |
| 502 | `upstream_error` (PayPal, Channel3 or Groq failed), `release_failed` (the PayPal release of a hold failed 3 times on close) |
| 503 | `webhooks_disabled` (no `PAYPAL_WEBHOOK_ID` is set), `channel3_webhooks_disabled` (no `CHANNEL3_WEBHOOK_SECRET`), `dispatch_failed` (a Channel3 wake could not start its check) |

## Health

`GET /api/health` returns `200 { "ok": true }`. It does no database work.

## Auth

`GET /api/auth/paypal/start` redirects (302) to the PayPal login page. It takes an optional `next`, which is kept only when it starts with `/api/paypal/return?`.

`GET /api/auth/paypal/callback?code&state` checks the state cookie, signs the user in, sets the `entole_session` cookie (7 days, httpOnly, SameSite=Lax), and redirects (302) to the saved `next`, or to `/mandates/new`. A bad state returns `400 invalid_state` and a missing code returns `400 missing_code`.

`POST /api/auth/logout` revokes the session and returns `200 { "ok": true }`.

`GET /api/me` returns `200 { user: { id, email, name }, taste: Taste | null }`, or 401.

```ts
type Taste = { brands: string[]; avoid: string[]; attributes: Record<string, string> };
```

## Access tokens

A personal access token lets an AI client, such as the MCP server in `apps/mcp`, act for one user. The format is `ent_` followed by 32 random bytes in base64url. The API stores only its SHA-256 hash, so the plaintext is returned once, at creation.

These three routes need a session cookie. A bearer token cannot create, list or revoke tokens.

`POST /api/tokens` takes `{ name: string }` (1 to 60 characters after trimming, else `400 invalid_field` with `field: "name"`) and returns `200 { id, token }`. A user may hold 20 active tokens, then `409 too_many_tokens`.

`GET /api/tokens` returns `200 ApiTokenView[]`, newest first, revoked tokens included. It never returns the token or its hash.

```ts
type ApiTokenView = { id: string; name: string; createdAt: string;
  lastUsedAt: string | null; revokedAt: string | null };
```

`DELETE /api/tokens/:id` revokes the token and returns `200 { "ok": true }`. A token that is not yours or is already revoked returns `404 not_found`.

### Bearer rules

`Authorization: Bearer ent_...` is accepted on these seven routes only, in place of the session cookie:

- `GET /api/me`
- `GET /api/mandates`
- `POST /api/mandates`
- `GET /api/mandates/:id`
- `GET /api/mandates/:id/ap2`
- `POST /api/mandates/:id/close`
- `POST /api/mandates/:id/schedule/propose`

When the header is present it is the only credential checked: an unknown, malformed or revoked token returns 401 even with a valid cookie. Each successful use sets `lastUsedAt`, at most once a minute. The create rate limit counts per user, so a token and the browser share it. Every other route, including the PayPal return, refund, simulate, check-now, replay, logout and the token routes, ignores the header and needs a session. So an AI client can draft and cancel orders, but only the user, approving in PayPal, can fund one.

## Mandates

Every route in this section needs a session (401 without one), except the bearer routes listed above. Routes with `:id` work only for the owner of the mandate (403 otherwise, 404 when it does not exist).

### Create

`POST /api/mandates`

Request:

```json
{ "query": "running shoes", "brands": ["Nike"], "avoid": ["white"],
  "requiredAttributes": { "Size": "10" }, "limitPrice": "170.00",
  "validDays": 3, "demoInjection": true, "replay": true }
```

Response `200`:

```json
{ "id": "mandate_…", "approveUrl": "https://www.sandbox.paypal.com/…",
  "candidates": [CandidateView], "rejected": [RejectedView] }
```

`query` is required. `brands`, `avoid`, `requiredAttributes`, `demoInjection` and `replay` are optional. A bad field returns `400 { "error": "invalid_field", "field": "<name>" }`:

- `query` is 1 to 200 characters after trimming.
- `brands` and `avoid` have at most 10 entries, each 1 to 60 characters.
- `requiredAttributes` has at most 10 entries, with keys and values of 1 to 60 characters.
- `limitPrice` is a decimal string from `"1.00"` to `"5000.00"` inclusive.
- `validDays` is a whole number from 1 to 29. Past 3 days the watcher reauthorizes the PayPal hold once.
- `demoInjection` and `replay` are booleans.

`replay` is stored on the mandate and is part of the signed digest. If no candidate is kept, the response is `422 { "error": "no_candidates", "rejected": [RejectedView] }`. Create is limited to 10 calls a minute per user, then `429 rate_limited`. It is also capped per 24 hours, counted from the stored mandates so a restart does not reset it: `MANDATE_DAILY_LIMIT_PER_USER` (default 30) per user, then `429 daily_limit_reached`, and `MANDATE_DAILY_LIMIT_TOTAL` (default 500) across all users, then `429 service_daily_limit_reached`. Only mandates that were created count.

### Idempotency

`POST /api/mandates`, `POST /api/mandates/:id/close` and `POST /api/mandates/:id/schedule/propose` honour an optional `Idempotency-Key` header, which the generated Entole SDK sends on every non-GET call. The key is 1 to 255 printable ASCII characters with no spaces, else `400 invalid_idempotency_key`. Keys are kept per caller:

- A retry with the same key, route and body gets the first answer back, with `Idempotent-Replayed: true`, for 24 hours.
- The same key with another route or body returns `422 idempotency_key_reused`.
- A retry while the first request is still running returns `409 idempotency_in_progress` with `Retry-After: 2`. A running request holds its key for at most 5 minutes, so a key left by a crashed process frees itself.
- A request that throws frees its key, so it can be retried. A request that outlives its 5 minute lease cannot overwrite or free the key once another request has taken it over.
- Without the header a call is not deduplicated; the web app sends none.

### Read

`GET /api/mandates/:id` returns `200 MandateView`.

`GET /api/mandates` returns the caller's mandates, newest first, as `200 MandateSummary[]`. With `?full=1` it returns `200 MandateView[]` instead, each exactly what `GET /api/mandates/:id` returns, in one call. The dashboard and the schedule use it rather than one read per order.

- `rejected` lists the items the shortlist turned down at create time, with the check's reasons. It is stored on the mandate but is not part of the signed digest. Mandates created before the field existed return `[]`.
- `approveUrl` is the PayPal approve link while the mandate is `awaiting_approval`, so the review page can reopen PayPal after a reload. It is `null` in every other status. Only the owner can read a mandate, so only the owner sees it.

### PayPal return

`GET /api/paypal/return?mandate&token` is where PayPal sends the browser after approval. `token` is the PayPal order id. Without both values it returns `400 invalid_return`.

- On success it funds the mandate and redirects (302) to `/mandates/:id`.
- On failure it redirects to `/mandates/:id?error=funding`.
- If the mandate is already funded or exhausted (a reload of the return URL), it redirects to `/mandates/:id` without the error.
- Without a session it redirects to `/api/auth/paypal/start?next=<this return URL>`. After login the callback sends the browser back to the return URL, which then funds.

If the user cancels at PayPal, PayPal sends the browser to the review page, `/mandates/:id/review?cancelled=1`, where they can approve again or change the rules.

### Check now

`POST /api/mandates/:id/check-now` runs one watcher check for this mandate and returns `200 { checked: number, captured: string[], mandate: MandateView }`. It is limited to 60 calls a minute per mandate, then 429.

### Replay

`POST /api/mandates/:id/replay/start` returns `200 { startedAt, msPerPoint, points: number }`.

- It works only for replay mandates (`409 not_replay`) that are funded (`409 not_funded`).
- It returns `422 no_price_history` when Channel3 has no history for any candidate.
- It shares the check-now limit of 60 calls a minute per mandate, then 429.

`GET /api/mandates/:id/prices` returns:

```ts
{
  replay: boolean;
  startedAt: string | null;
  msPerPoint: number;
  candidates: {
    productId: string;
    title: string;
    limit: string; // "170.00"
    points: { at: string; price: string }[];
    currentIndex: number | null;
    current: string | null;
    stats: null | {   // null when there is no point
      low: string;    // lowest price in the fetched history (Entole asks for 30 days)
      high: string;
      current: string; // the latest point
      aboveLowPercent: number | null; // whole percent above the low, null when the low is 0
    };
  }[];
}
```

There is no "today" range: Channel3 history has one point per day.

### AP2 export

`GET /api/mandates/:id/ap2` returns the mandate as Agent Payments Protocol v0.2 mandates, as a JSON download (`Content-Disposition: attachment`). Owner only; a session or a bearer token works. The body is `{ protocol: "AP2", version: "0.2", mode: "human_not_present", signed: false, note, entole: { mandateId, status, digest, paypal: { orderId, customId, authorizationId, captureId, refundId } }, openCheckoutMandate, openPaymentMandate, checkoutMandate, paymentMandate }`. The two closed mandates are `null` until the one capture. Field names inside the four mandates follow the AP2 schemas (`vct`, `constraints`, `checkout_jwt`, `transaction_id` and so on). Nothing is signed: Entole has no buyer or agent signing key, and `note` says what that means.

### Simulate

`POST /api/mandates/:id/simulate` proposes the planted demo listing through the real check, as a compromised agent would, and returns `200 { verdict: VerdictView }`. It works only for mandates created with `demoInjection` (`409 not_demo` otherwise) and shares the check-now limit, then 429.

### Schedule proposals

An agent may propose one extra price check for a funded limit order; the buyer accepts or rejects it on the schedule page. Both routes share the check-now limit (propose is also limited to 10 a minute per owner, then `429 rate_limited`), return `200 MandateView`, and answer `409 not_watching` for an order that is not funded. Each step is an `agent_step` audit entry with `data.schedule` set to `proposed`, `accepted` or `rejected`.

- `POST /api/mandates/:id/schedule/propose` takes `{ at?: string, reason?: string }` (session or bearer). With no `at`, the watcher picks a time from how close the best known price is to the limit (5, 15 or 45 minutes ahead). `data` carries `at`, `reason` and `by` (`watcher`, `ai_client` or `auto`). `auto` is the watcher proposing on its own during a check: when the best quote is above the limit by at most 5%, nothing is already planned ahead, and it has not done so for that order in the last 6 hours, it proposes a check 15 minutes ahead (clamped to one minute before `latestCheckAt`), and none at all when less than 5 minutes would be left.
- `POST /api/mandates/:id/schedule/decide` takes `{ accept: boolean, at?: string }` (session only). `at` is where the buyer dragged the proposal; it defaults to the proposed time. Accepting arms the check in the API process. `409 no_pending_proposal` when the latest step is not an open proposal.
- Any `at` must be after now and no later than `latestCheckAt` (the earlier of `validUntil` and the PayPal hold's expiry): `422 check_in_past` or `422 past_valid_until`, `400 invalid_field` when it is not a date.

### Close

`POST /api/mandates/:id/close` closes the mandate, voids what is left of the hold, and returns `200 MandateView`. If the PayPal void has failed 3 times, it returns `502 release_failed`.

### Refund

`POST /api/mandates/:id/refund` refunds the full capture of a bought mandate (sandbox only) and returns `200 MandateView` with `outcome: "refunded"` and a `refunded` audit entry. It returns `409 not_refundable` when nothing was captured. Calling it again returns the current view without a second refund.

## Dashboard assistant

`POST /api/studio/chat` runs one model turn for the agents in the dashboard's AI panel. It needs a session (401 without one; a bearer token is not accepted). The agents run in the browser, and the API adds the Groq key, so the key never reaches the page.

The body is a subset of the OpenAI chat-completions request. Only these fields are read; anything else, such as `model`, `temperature` or `stream`, is dropped, and the server always uses its own model.

```ts
type StudioChatRequest = {
  messages: ChatMessage[];   // 1 to 80
  tools?: ChatTool[];        // up to 32, names from the list below
  tool_choice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };
  response_format?: { type: "text" } | { type: "json_schema"; json_schema: { name: string; schema: object } };
  max_tokens?: number;       // default 2048, capped at 4096
};
type ChatToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ChatToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
type ChatTool = { type: "function"; function: { name: string; description: string; parameters: object } };
```

It returns `200 { message: { role: "assistant", content: string | null, tool_calls?: ChatToolCall[] }, finish_reason: string }`. Reasoning text and token usage from Groq are not passed on.

- Tool names are limited to the tools AG Studio 3.0.0 gives its agents (`view_schema`, `view_report`, `view_page`, `view_widget`, `execute_query`, `create_expression`, `update_expression`, `delete_expression`, `add_widget`, `position_widget`, `remove_widget`, `add_page_filter`, `remove_page_filter`, `add_widget_filter`, `remove_widget_filter`, `configure_widget`, `view_plan`, `create_plan`, `update_plan`, `clear_plan`, `rename_thread`, `delegate_to`, `complete_task`) plus the dashboard's own `savings_breakdown`. Any other name, in `tools`, `tool_choice` or an assistant tool call, returns `400 invalid_field` with `field` set to where it appeared.
- A malformed message returns `400 invalid_field` with `field: "messages"`, and a bad `max_tokens` returns it with `field: "max_tokens"`.
- A body over 256,000 characters returns `413 body_too_large`.
- Each user may make 30 calls a minute and 300 a day, then `429 rate_limited`. One question can take several calls when agents hand work to each other.
- A Groq rate limit returns `429 upstream_rate_limited`, and any other Groq failure returns `502 upstream_error`. The panel shows a short note for either and the dashboard keeps working.

## PayPal webhook

`POST /api/paypal/webhook` is called by PayPal, not by the web app, so it needs no session. The body is the PayPal event JSON.

- Without `PAYPAL_WEBHOOK_ID` it returns `503 webhooks_disabled`.
- More than 30 requests a minute from one client, or 300 in total, return `429 rate_limited`. The client is the first `X-Forwarded-For` entry, which Render and Vercel set.
- A `paypal-transmission-time` that is missing or more than 15 minutes from now returns `400 stale_transmission`, and a body over 32 KB returns `413 body_too_large`. Neither checks the signature.
- A body that is not JSON returns `400 invalid_json`, and an event without an `id` or `event_type` returns `400 invalid_event`.
- The API checks the signature itself: it fetches the cert named in `paypal-cert-url` (https on a `paypal.com` host only, cached by URL, inside its validity dates) and verifies `paypal-transmission-sig` as SHA256withRSA over `transmission id|transmission time|webhook id|CRC32 of the raw body`. `paypal-auth-algo` must be `SHA256withRSA`. Anything else returns `400 invalid_signature`.
- If PayPal fails to serve the cert, the answer is 500 and PayPal retries the delivery later.
- A verified event returns `200 { "ok": true }`. `CHECKOUT.ORDER.APPROVED` funds the mandate for that order, the same way the PayPal return does. `PAYMENT.CAPTURE.COMPLETED`, `.DENIED`, `.REVERSED`, `.REFUNDED` and `PAYMENT.AUTHORIZATION.VOIDED` add a `paypal_event` audit entry to the mandate. Other event types, unknown orders and an event id seen before are ignored with 200.
- If PayPal itself fails during funding, the answer is 502 or 500 and PayPal retries the delivery later.

## Channel3 webhook

`POST /api/channel3/webhook` is called by Channel3 through Svix, not by the web app, so it needs no session; the Svix signature is the authentication.

- Without `CHANNEL3_WEBHOOK_SECRET` it returns `503 channel3_webhooks_disabled`.
- Missing `svix-id`, `svix-timestamp` or `svix-signature` returns `400 missing_signature_headers`. A signature that does not match, or a timestamp more than 5 minutes from now, returns `401 invalid_signature`; those count against their own limit of 30 a minute per client, then `429 rate_limited`. Verified deliveries share 600 a minute.
- A verified body that is not JSON (`400 invalid_json`) or not a readable offer event (`400 invalid_event`, including an id over 128 characters) carries `webhook-delivery: abort-message`, so Svix stops retrying it (documented by Svix and Channel3).
- An event id seen in the last 24 hours returns `200 { ok: true, duplicate: true }`. A type Entole does not act on returns `200 { ok: true, ignored: true }`.
- Otherwise each funded limit order that signed the product at the event's shop, and for which the event matters (a price at or under the limit, or back in stock), gets a check started and a "Channel3 reported ..., checking now" audit entry with `data.eventId`, and the answer is `200 { ok: true, checks: number }`. When the check ran on Render, a second entry with the same `eventId` carries `data.taskRunId`. If a check cannot be started the answer is `503 dispatch_failed` and Svix retries. A failed audit write after the checks started is logged and still answers 200, so the checks are not started twice.

## PayPal shipping callback

`POST /api/paypal/shipping-callback?mandate=<id>` is PayPal's Orders v2 order update callback. PayPal calls it while the buyer is on the approval page, when the page loads and whenever the buyer picks another ship-to address. The order asks for it (`order_update_callback_config` with `SHIPPING_ADDRESS`) only when `PAYPAL_SHIPPING_CALLBACK=on` and `PUBLIC_BASE_URL` is https. No session. The body is PayPal's callback JSON: `id` (the order), `shipping_address` with `country_code`, `admin_area_1`, `admin_area_2` and `postal_code` only, and `purchase_units`.

- More than 600 requests a minute in total return `429 rate_limited`. It is left out of the per-IP ceiling, since PayPal sends every buyer's callback from the same few addresses.
- A `paypal-transmission-time` more than 15 minutes from now returns `400 stale_transmission`, and a body over 32 KB returns `413 body_too_large`.
- The signature is checked like the webhook's, over `transmission id|transmission time|CRC32 of the raw body` (callbacks carry no webhook id). A bad one returns `401 invalid_signature`.
- A body that is not JSON returns `400 invalid_json`; one without `id` or `shipping_address.country_code` returns `400 invalid_callback`.
- An order that is unknown, belongs to another mandate than `mandate`, or is no longer awaiting approval returns `404 not_found`, the same answer in every case.
- A US address returns `200` with the order `id` and one purchase unit: the signed budget as the total (`item_total` the budget, `shipping` 0.00) and one selected free shipping option.
- Any other country returns `422 { "name": "UNPROCESSABLE_ENTITY", "details": [{ "issue": "COUNTRY_ERROR" }] }`, which PayPal shows on the approval page, and adds a `ship_to_refused` audit entry to the mandate.

## Views

```ts
type CandidateView = { productId: string; merchant: string; title: string;
  shops: string[];       // every signed shop, merchant first; one entry on older mandates
  options: Record<string,string>; baselinePrice: string };

type RejectedView = { title: string; merchant: string; details: string[] };

type VerdictView = { kind: "allow" } | { kind: "block"; reasons: string[]; details: string[] };

type AuditView = { at: string;
  kind: "created"|"funded"|"agent_step"|"proposal_allowed"|"proposal_blocked"|"capture_failed"|"paypal_event"|"refunded"|"hold_renewed"|"ship_to_refused"|"closed";
  message: string; data?: Record<string,string> };

type Outcome = "needs_approval"|"expired"|"watching"|"bought"|"refunded"|"released"|"cancelled";

type MandateSummary = { id: string; status: MandateView["status"]; outcome: Outcome;
  query: string; limitPrice: string; captured: string; createdAt: string; validUntil: string };

type MandateView = {
  id: string; status: "awaiting_approval"|"funded"|"exhausted"|"closed";
  outcome: Outcome;      // what happened, for people; status stays the payment lifecycle
  kind: "standard"|"limit"; digest: string; createdAt: string; validUntil: string;
  latestCheckAt: string; // the latest time a check may be proposed or dragged to
  terms: { query: string; brands: string[]; avoid: string[];
           requiredAttributes: Record<string,string>; limitPrice: string; budget: string;
           allowedMerchants: string[] };
  candidates: CandidateView[];
  rejected: RejectedView[];      // items the shortlist turned down, [] on older mandates
  approveUrl: string | null;     // PayPal approve link while awaiting_approval, else null
  held: string;          // authorization amount, "0.00" before funding
  captured: string; remaining: string; voided: boolean;
  authorizationId: string | null;
  demoInjection: boolean; replay: boolean;
  purchase: null | {     // set after a capture
    productId: string; title: string; merchant: string; price: string;
    shopsCompared: number; // shops with a live quote at the buy, 1 on older purchases
    captureId: string; savings: string; inReplay: boolean;
    // PayPal's answer on the capture; null on purchases made before it was recorded
    paypal: { status: string|null; sellerProtection: string|null; fee: string|null; net: string|null };
    shipTo: null | { name: string; lines: string[]; city: string; region: string;
                     postalCode: string; country: string };  // from the PayPal approval
    whyThisOne: { chosen: string; skipped: { title: string; reasons: string[] }[] } };
  receipt: {             // everything PayPal-side
    paypalOrderId: string|null; authorizationId: string|null; captureId: string|null;
    refundId: string|null;
    customId: string;    // the digest, sent as the order's custom_id
    holdRenewed: null | { at: string; authorizationId: string; previousAuthorizationId: string };
    amounts: { held: string; captured: string; released: string; refunded: string };
    times: { approved: string|null; captured: string|null; released: string|null;
             refunded: string|null };
    confirmations: { at: string; eventType: string; message: string; eventId: string }[] };
  audit: AuditView[];
  sandbox: true;
};
```
