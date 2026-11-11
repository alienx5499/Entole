import { buildAuthSchemes, type AuthSchemes } from "./auth-schemes.js";
import type { ClientOptions } from "./client-options.js";
import { ApiError, type Declared, type Undeclared } from "./core/api-error.js";
import type { ApiPromise } from "./core/api-promise.js";
import type { RequestOptions } from "./core/api-request.js";
import { buildCoreClientOptions } from "./core/client-options.js";
import { RawClient } from "./core/raw-client.js";
import type { ErrorDecoders } from "./core/response-decoder.js";
import * as host from "./core/runtime-environment.js";
import { uuid } from "./core/uuid.js";
import * as s from "./core/validation/index.js";
import type { Schema } from "./core/validation/schema.js";
import { ap2ExportInternalSchema, type Ap2Export } from "./models/ap2-export.js";
import { apiErrorModelSchema, type ApiErrorModel } from "./models/api-error-model.js";
import {
  createLimitOrderRequestInternalSchema,
  type CreateLimitOrderRequest,
} from "./models/create-limit-order-request.js";
import { createdLimitOrderInternalSchema, type CreatedLimitOrder } from "./models/created-limit-order.js";
import { mandateSummaryInternalSchema, type MandateSummary } from "./models/mandate-summary.js";
import { mandateViewInternalSchema, type MandateView } from "./models/mandate-view.js";
import { meSchema, type Me } from "./models/me.js";
import { proposeCheckRequestSchema, type ProposeCheckRequest } from "./models/propose-check-request.js";
import { buildServers, type Servers } from "./servers.js";

/**
 * The agent-facing part of the Entole API: the routes a personal access token (`Authorization:
 * Bearer ent_...`) may call. Entole runs on the PayPal sandbox only. An AI agent can draft a limit
 * order, read it, propose an extra price check and cancel it, but it can never pay: a new order
 * waits in `awaiting_approval` until the human opens `approveUrl` and approves the hold in PayPal,
 * and only then may the watcher capture at or under the signed limit. Money is always a decimal
 * string in USD, such as `"159.00"`, and dates are ISO 8601 strings. Tokens are created, listed and
 * revoked from a browser session at /connect, never with a token.
 *
 * The three POST operations honour an optional `Idempotency-Key` header (1 to 255 printable ASCII
 * characters, no spaces; the generated SDK mints one per call). Entole keeps the answer for 24
 * hours per caller and key: a retry with the same key and body gets the stored answer back with
 * `Idempotent-Replayed: true`, the same key with another body or route is `422
 * idempotency_key_reused`, a retry while the first is still running is `409
 * idempotency_in_progress`, and a malformed key is `400 invalid_idempotency_key`. A request that
 * fails frees its key; a running request holds it for at most 5 minutes. Without the header every
 * call runs.
 */
export class EntoleApiClient {
  readonly #rawClient: RawClient;
  readonly #servers: Servers;
  readonly #auth: AuthSchemes;

  constructor(options: ClientOptions = {}) {
    this.#rawClient = new RawClient({
      ...buildCoreClientOptions(options, "ENTOLE_API_CLIENT_LOG"),
      defaultHeaders: [
        { name: "User-Agent", value: "EntoleApiClient/1.0.0 TypeScript", schema: s.string() },
        { name: "X-APIMatic-Lang", value: "TypeScript", schema: s.string() },
        { name: "X-APIMatic-Package-Version", value: "1.0.0", schema: s.string() },
        { name: "X-APIMatic-Gen-Version", value: "4.0.0", schema: s.string() },
        { name: "X-APIMatic-OS", value: host.operatingSystem(), schema: s.optional(s.string()) },
        { name: "X-APIMatic-Runtime", value: host.runtimeDescription(), schema: s.optional(s.string()) },
      ],
      defaultQuery: [],
      defaultPathParams: [],
    });

    this.#servers = buildServers(options);

    this.#auth = buildAuthSchemes(options);
  }

  /**
   * Cancel the order and release what is left of the PayPal hold
   *
   * @remarks
   * Shares the money limit of 20 calls a minute per user. If the PayPal void has failed 3 times,
   * the answer is `502 release_failed`. Idempotency-Key (optional header, sent by the generated
   * SDK): a retry with the same key on the same order gets the stored answer for 24 hours with the
   * response header `Idempotent-Replayed: true`; another order or route is `422
   * idempotency_key_reused`, a retry while the first runs is `409 idempotency_in_progress` with
   * `Retry-After: 2`, and a malformed key is `400 invalid_idempotency_key`.
   *
   * @returns The closed order.
   *
   * @throws {@link EntoleApiClient.CancelLimitOrderError} when the API answers with an error status
   * — narrow on `err.payload.kind`
   *
   * @throws {@link EntoleApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  cancelLimitOrder(
    request: EntoleApiClient.CancelLimitOrderRequest,
    options?: RequestOptions,
  ): ApiPromise<MandateView, EntoleApiClient.CancelLimitOrderError> {
    return this.#rawClient.execute(
      {
        method: "POST",
        urlTemplate: this.#servers.default("/api/mandates/{id}/close"),
        auth: this.#auth.bearer,
        pathParams: [{ name: "id", value: request.id, schema: s.string() }],
        query: [],
        headers: [{ name: "Idempotency-Key", value: uuid(), schema: s.string() }],
        body: { kind: "empty" },
      },
      {
        success: { kind: "json", schema: mandateViewInternalSchema },
        errorFactory: EntoleApiClient.CancelLimitOrderError,
      },
      options,
    );
  }

  /**
   * Draft a limit order
   *
   * @remarks
   * The shopping agent shortlists up to 3 items that fit the terms, and Entole creates a PayPal
   * order for a hold of `limitPrice`. Nothing is held or paid until the human opens `approveUrl`
   * and approves in PayPal. Limited to 10 calls a minute per user (`rate_limited`), 30 a day per
   * user (`daily_limit_reached`) and 500 a day in total (`service_daily_limit_reached`).
   * Idempotency-Key (optional header, sent by the generated SDK): a retry with the same key and
   * body gets the stored answer for 24 hours with the response header `Idempotent-Replayed: true`;
   * another body is `422 idempotency_key_reused`, a retry while the first runs is `409
   * idempotency_in_progress` with `Retry-After: 2`, and a malformed key is `400
   * invalid_idempotency_key`.
   *
   * @returns The drafted order, awaiting the human's PayPal approval.
   *
   * @throws {@link EntoleApiClient.CreateLimitOrderError} when the API answers with an error status
   * — narrow on `err.payload.kind`
   *
   * @throws {@link EntoleApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  createLimitOrder(
    request: EntoleApiClient.CreateLimitOrderRequestParams,
    options?: RequestOptions,
  ): ApiPromise<CreatedLimitOrder, EntoleApiClient.CreateLimitOrderError> {
    return this.#rawClient.execute(
      {
        method: "POST",
        urlTemplate: this.#servers.default("/api/mandates"),
        auth: this.#auth.bearer,
        pathParams: [],
        query: [],
        headers: [{ name: "Idempotency-Key", value: uuid(), schema: s.string() }],
        body: { kind: "json", value: request.body, schema: createLimitOrderRequestInternalSchema },
      },
      {
        success: { kind: "json", schema: createdLimitOrderInternalSchema },
        errorFactory: EntoleApiClient.CreateLimitOrderError,
      },
      options,
    );
  }

  /**
   * The order as Agent Payments Protocol v0.2 mandates
   *
   * @remarks
   * Unsigned AP2 claim sets, served as a JSON download, so an agent can hand the order to another
   * agent. `checkoutMandate` and `paymentMandate` stay null until the one capture.
   *
   * @returns The AP2 export.
   *
   * @throws {@link EntoleApiClient.GetAp2MandatesError} when the API answers with an error status —
   * narrow on `err.payload.kind`
   *
   * @throws {@link EntoleApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  getAp2Mandates(
    request: EntoleApiClient.GetAp2MandatesRequest,
    options?: RequestOptions,
  ): ApiPromise<Ap2Export, EntoleApiClient.GetAp2MandatesError> {
    return this.#rawClient.execute(
      {
        method: "GET",
        urlTemplate: this.#servers.default("/api/mandates/{id}/ap2"),
        auth: this.#auth.bearer,
        pathParams: [{ name: "id", value: request.id, schema: s.string() }],
        query: [],
        headers: [],
        body: { kind: "empty" },
      },
      {
        success: { kind: "json", schema: ap2ExportInternalSchema },
        errorFactory: EntoleApiClient.GetAp2MandatesError,
      },
      options,
    );
  }

  /**
   * The token's owner and their saved taste
   *
   * @remarks
   * Read only: returns the user who owns the bearer token and the brands, avoids and attributes
   * Entole saved from their funded orders (`taste` is null until one order was funded). It moves no
   * money and changes nothing. Like every route it shares the per-IP limit of 240 calls a minute
   * (`rate_limited`).
   *
   * @returns The signed-in user.
   *
   * @throws {@link EntoleApiClient.GetCurrentUserError} when the API answers with an error status —
   * narrow on `err.payload.kind`
   *
   * @throws {@link EntoleApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  getCurrentUser(options?: RequestOptions): ApiPromise<Me, EntoleApiClient.GetCurrentUserError> {
    return this.#rawClient.execute(
      {
        method: "GET",
        urlTemplate: this.#servers.default("/api/me"),
        auth: this.#auth.bearer,
        pathParams: [],
        query: [],
        headers: [],
        body: { kind: "empty" },
      },
      {
        success: { kind: "json", schema: meSchema },
        errorFactory: EntoleApiClient.GetCurrentUserError,
      },
      options,
    );
  }

  /**
   * One limit order with its terms, purchase, receipt and audit trail
   *
   * @remarks
   * Read only: the full view of one order the token's owner created, with its signed terms,
   * shortlist, PayPal hold amounts, the purchase once the watcher bought, the PayPal receipt and
   * every audit entry. `approveUrl` is always null here. It moves no money; another user's order is
   * `403 forbidden`. Like every route it shares the per-IP limit of 240 calls a minute
   * (`rate_limited`).
   *
   * @returns The order.
   *
   * @throws {@link EntoleApiClient.GetLimitOrderError} when the API answers with an error status —
   * narrow on `err.payload.kind`
   *
   * @throws {@link EntoleApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  getLimitOrder(
    request: EntoleApiClient.GetLimitOrderRequest,
    options?: RequestOptions,
  ): ApiPromise<MandateView, EntoleApiClient.GetLimitOrderError> {
    return this.#rawClient.execute(
      {
        method: "GET",
        urlTemplate: this.#servers.default("/api/mandates/{id}"),
        auth: this.#auth.bearer,
        pathParams: [{ name: "id", value: request.id, schema: s.string() }],
        query: [],
        headers: [],
        body: { kind: "empty" },
      },
      {
        success: { kind: "json", schema: mandateViewInternalSchema },
        errorFactory: EntoleApiClient.GetLimitOrderError,
      },
      options,
    );
  }

  /**
   * The owner's limit orders, newest first
   *
   * @remarks
   * One summary row per order; call `getLimitOrder` for the full view.
   *
   * @returns The owner's orders.
   *
   * @throws {@link EntoleApiClient.ListLimitOrdersError} when the API answers with an error status
   * — narrow on `err.payload.kind`
   *
   * @throws {@link EntoleApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  listLimitOrders(
    options?: RequestOptions,
  ): ApiPromise<MandateSummary[], EntoleApiClient.ListLimitOrdersError> {
    return this.#rawClient.execute(
      {
        method: "GET",
        urlTemplate: this.#servers.default("/api/mandates"),
        auth: this.#auth.bearer,
        pathParams: [],
        query: [],
        headers: [],
        body: { kind: "empty" },
      },
      {
        success: { kind: "json", schema: s.array(s.lazy(() => mandateSummaryInternalSchema)) },
        errorFactory: EntoleApiClient.ListLimitOrdersError,
      },
      options,
    );
  }

  /**
   * Propose one extra price check on a funded order
   *
   * @remarks
   * The proposal moves nothing: the human accepts or rejects it on the schedule page. With no `at`,
   * the watcher picks a time 15 minutes ahead, clamped to one minute before `latestCheckAt`, and
   * refuses with `422 past_valid_until` when less than 5 minutes would be left. Shares the
   * check-now limit of 60 calls a minute per order. Idempotency-Key (optional header, sent by the
   * generated SDK): a retry with the same key and body gets the stored answer for 24 hours with the
   * response header `Idempotent-Replayed: true`; another body is `422 idempotency_key_reused`, a
   * retry while the first runs is `409 idempotency_in_progress` with `Retry-After: 2`, and a
   * malformed key is `400 invalid_idempotency_key`.
   *
   * @returns The order with the proposal as its newest `agent_step` audit entry.
   *
   * @throws {@link EntoleApiClient.ProposeExtraCheckError} when the API answers with an error
   * status — narrow on `err.payload.kind`
   *
   * @throws {@link EntoleApiError} when no usable response was produced: a connection failure, a
   * timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  proposeExtraCheck(
    request: EntoleApiClient.ProposeExtraCheckRequest,
    options?: RequestOptions,
  ): ApiPromise<MandateView, EntoleApiClient.ProposeExtraCheckError> {
    return this.#rawClient.execute(
      {
        method: "POST",
        urlTemplate: this.#servers.default("/api/mandates/{id}/schedule/propose"),
        auth: this.#auth.bearer,
        pathParams: [{ name: "id", value: request.id, schema: s.string() }],
        query: [],
        headers: [{ name: "Idempotency-Key", value: uuid(), schema: s.string() }],
        body: { kind: "json", value: request.body, schema: proposeCheckRequestSchema },
      },
      {
        success: { kind: "json", schema: mandateViewInternalSchema },
        errorFactory: EntoleApiClient.ProposeExtraCheckError,
      },
      options,
    );
  }
}

export namespace EntoleApiClient {
  export type CancelLimitOrderRequest = {
    /** The limit order id. */
    id: string;
  };

  export const cancelLimitOrderRequestSchema: Schema<CancelLimitOrderRequest> = s.lazySchema(() =>
    s.object<CancelLimitOrderRequest>({
      id: s.string().check(s.minLength(1)),
    }),
  );

  export class CancelLimitOrderError extends ApiError {
    declare readonly payload:
      | Declared<"apiErrorModel", ApiErrorModel>
      | Declared<"apiErrorModel2", ApiErrorModel>
      | Declared<"apiErrorModel3", ApiErrorModel>
      | Declared<"apiErrorModel4", ApiErrorModel>
      | Declared<"apiErrorModel5", ApiErrorModel>
      | Declared<"apiErrorModel6", ApiErrorModel>
      | Undeclared;

    static readonly errors: ErrorDecoders<CancelLimitOrderError> = [
      { on: 401, kind: "apiErrorModel", decode: { kind: "json", schema: apiErrorModelSchema } },
      { on: 403, kind: "apiErrorModel2", decode: { kind: "json", schema: apiErrorModelSchema } },
      { on: 404, kind: "apiErrorModel3", decode: { kind: "json", schema: apiErrorModelSchema } },
      { on: 429, kind: "apiErrorModel4", decode: { kind: "json", schema: apiErrorModelSchema } },
      { on: 500, kind: "apiErrorModel5", decode: { kind: "json", schema: apiErrorModelSchema } },
      { on: 502, kind: "apiErrorModel6", decode: { kind: "json", schema: apiErrorModelSchema } },
    ];
  }

  export type CreateLimitOrderRequestParams = {
    /**
     * The terms the human will sign: what to buy, the most to pay and how many days to watch. They
     * are hashed into the order's digest, so they cannot change after approval.
     */
    body: CreateLimitOrderRequest;
  };

  export class CreateLimitOrderError extends ApiError {
    declare readonly payload:
      | Declared<"apiErrorModel", ApiErrorModel>
      | Declared<"apiErrorModel2", ApiErrorModel>
      | Declared<"apiErrorModel3", ApiErrorModel>
      | Declared<"apiErrorModel4", ApiErrorModel>
      | Declared<"apiErrorModel5", ApiErrorModel>
      | Declared<"apiErrorModel6", ApiErrorModel>
      | Undeclared;

    static readonly errors: ErrorDecoders<CreateLimitOrderError> = [
      { on: 400, kind: "apiErrorModel", decode: { kind: "json", schema: apiErrorModelSchema } },
      { on: 401, kind: "apiErrorModel2", decode: { kind: "json", schema: apiErrorModelSchema } },
      { on: 422, kind: "apiErrorModel3", decode: { kind: "json", schema: apiErrorModelSchema } },
      { on: 429, kind: "apiErrorModel4", decode: { kind: "json", schema: apiErrorModelSchema } },
      { on: 500, kind: "apiErrorModel5", decode: { kind: "json", schema: apiErrorModelSchema } },
      { on: 502, kind: "apiErrorModel6", decode: { kind: "json", schema: apiErrorModelSchema } },
    ];
  }

  export type GetAp2MandatesRequest = {
    /** The limit order id. */
    id: string;
  };

  export const getAp2MandatesRequestSchema: Schema<GetAp2MandatesRequest> = s.lazySchema(() =>
    s.object<GetAp2MandatesRequest>({
      id: s.string().check(s.minLength(1)),
    }),
  );

  export class GetAp2MandatesError extends ApiError {
    declare readonly payload:
      | Declared<"apiErrorModel", ApiErrorModel>
      | Declared<"apiErrorModel2", ApiErrorModel>
      | Declared<"apiErrorModel3", ApiErrorModel>
      | Declared<"apiErrorModel4", ApiErrorModel>
      | Declared<"apiErrorModel5", ApiErrorModel>
      | Undeclared;

    static readonly errors: ErrorDecoders<GetAp2MandatesError> = [
      { on: 401, kind: "apiErrorModel", decode: { kind: "json", schema: apiErrorModelSchema } },
      { on: 403, kind: "apiErrorModel2", decode: { kind: "json", schema: apiErrorModelSchema } },
      { on: 404, kind: "apiErrorModel3", decode: { kind: "json", schema: apiErrorModelSchema } },
      { on: 429, kind: "apiErrorModel4", decode: { kind: "json", schema: apiErrorModelSchema } },
      { on: 500, kind: "apiErrorModel5", decode: { kind: "json", schema: apiErrorModelSchema } },
    ];
  }

  export class GetCurrentUserError extends ApiError {
    declare readonly payload:
      | Declared<"apiErrorModel", ApiErrorModel>
      | Declared<"apiErrorModel2", ApiErrorModel>
      | Declared<"apiErrorModel3", ApiErrorModel>
      | Undeclared;

    static readonly errors: ErrorDecoders<GetCurrentUserError> = [
      { on: 401, kind: "apiErrorModel", decode: { kind: "json", schema: apiErrorModelSchema } },
      { on: 429, kind: "apiErrorModel2", decode: { kind: "json", schema: apiErrorModelSchema } },
      { on: 500, kind: "apiErrorModel3", decode: { kind: "json", schema: apiErrorModelSchema } },
    ];
  }

  export type GetLimitOrderRequest = {
    /** The limit order id. */
    id: string;
  };

  export const getLimitOrderRequestSchema: Schema<GetLimitOrderRequest> = s.lazySchema(() =>
    s.object<GetLimitOrderRequest>({
      id: s.string().check(s.minLength(1)),
    }),
  );

  export class GetLimitOrderError extends ApiError {
    declare readonly payload:
      | Declared<"apiErrorModel", ApiErrorModel>
      | Declared<"apiErrorModel2", ApiErrorModel>
      | Declared<"apiErrorModel3", ApiErrorModel>
      | Declared<"apiErrorModel4", ApiErrorModel>
      | Declared<"apiErrorModel5", ApiErrorModel>
      | Undeclared;

    static readonly errors: ErrorDecoders<GetLimitOrderError> = [
      { on: 401, kind: "apiErrorModel", decode: { kind: "json", schema: apiErrorModelSchema } },
      { on: 403, kind: "apiErrorModel2", decode: { kind: "json", schema: apiErrorModelSchema } },
      { on: 404, kind: "apiErrorModel3", decode: { kind: "json", schema: apiErrorModelSchema } },
      { on: 429, kind: "apiErrorModel4", decode: { kind: "json", schema: apiErrorModelSchema } },
      { on: 500, kind: "apiErrorModel5", decode: { kind: "json", schema: apiErrorModelSchema } },
    ];
  }

  export class ListLimitOrdersError extends ApiError {
    declare readonly payload:
      | Declared<"apiErrorModel", ApiErrorModel>
      | Declared<"apiErrorModel2", ApiErrorModel>
      | Declared<"apiErrorModel3", ApiErrorModel>
      | Undeclared;

    static readonly errors: ErrorDecoders<ListLimitOrdersError> = [
      { on: 401, kind: "apiErrorModel", decode: { kind: "json", schema: apiErrorModelSchema } },
      { on: 429, kind: "apiErrorModel2", decode: { kind: "json", schema: apiErrorModelSchema } },
      { on: 500, kind: "apiErrorModel3", decode: { kind: "json", schema: apiErrorModelSchema } },
    ];
  }

  export type ProposeExtraCheckRequest = {
    /** The limit order id. */
    id: string;
    /** When to check and why. Send `{}` to let the watcher pick the time and write the reason. */
    body: ProposeCheckRequest;
  };

  export const proposeExtraCheckRequestSchema: Schema<ProposeExtraCheckRequest> = s.lazySchema(() =>
    s.object<ProposeExtraCheckRequest>({
      id: s.string().check(s.minLength(1)),
      body: proposeCheckRequestSchema,
    }),
  );

  export class ProposeExtraCheckError extends ApiError {
    declare readonly payload:
      | Declared<"apiErrorModel", ApiErrorModel>
      | Declared<"apiErrorModel2", ApiErrorModel>
      | Declared<"apiErrorModel3", ApiErrorModel>
      | Declared<"apiErrorModel4", ApiErrorModel>
      | Declared<"apiErrorModel5", ApiErrorModel>
      | Declared<"apiErrorModel6", ApiErrorModel>
      | Declared<"apiErrorModel7", ApiErrorModel>
      | Declared<"apiErrorModel8", ApiErrorModel>
      | Undeclared;

    static readonly errors: ErrorDecoders<ProposeExtraCheckError> = [
      { on: 400, kind: "apiErrorModel", decode: { kind: "json", schema: apiErrorModelSchema } },
      { on: 401, kind: "apiErrorModel2", decode: { kind: "json", schema: apiErrorModelSchema } },
      { on: 403, kind: "apiErrorModel3", decode: { kind: "json", schema: apiErrorModelSchema } },
      { on: 404, kind: "apiErrorModel4", decode: { kind: "json", schema: apiErrorModelSchema } },
      { on: 409, kind: "apiErrorModel5", decode: { kind: "json", schema: apiErrorModelSchema } },
      { on: 422, kind: "apiErrorModel6", decode: { kind: "json", schema: apiErrorModelSchema } },
      { on: 429, kind: "apiErrorModel7", decode: { kind: "json", schema: apiErrorModelSchema } },
      { on: 500, kind: "apiErrorModel8", decode: { kind: "json", schema: apiErrorModelSchema } },
    ];
  }
}
