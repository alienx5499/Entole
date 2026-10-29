<!-- Generated file — do not edit; regenerated with the SDK. -->

# EntoleApiClient — ungrouped operations

Accessor: `client` (the client itself) · Source: `src/client.ts` · 7 operations · Request and error types: namespace `EntoleApiClient`

Operations the spec leaves untagged are methods on the client rather than on a resource, so there is no accessor property to go through. The request type still lives in a namespace merged onto the exported class, so you write `EntoleApiClient.CancelLimitOrderRequest`.

**Type sources**: every type an operation names, with the file that declares it and the schema value exported beside it. Import every name from `entole-api`; the `Source` path is where to **read** the shape, never what to import. `ApiError`, the runtime error family and the file vocabulary are excluded — see sdk-map.md.

### cancelLimitOrder

- **Signature**: `cancelLimitOrder(request: EntoleApiClient.CancelLimitOrderRequest, options?: RequestOptions): ApiPromise<MandateView, EntoleApiClient.CancelLimitOrderError>`
- **Wire**: `POST /api/mandates/{id}/close`
- **Auth**: `bearer`
- **Request body**: none — no `Content-Type` header is sent
- **SDK-sent**: `header Idempotency-Key` (minted per call)
- **Returns**: `MandateView`
- **Error**: `EntoleApiError` with `kind: "api"`, an instance of `EntoleApiClient.CancelLimitOrderError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"apiErrorModel"` [401] `ApiErrorModel` · `"apiErrorModel2"` [403] `ApiErrorModel` · `"apiErrorModel3"` [404] `ApiErrorModel` · `"apiErrorModel4"` [429] `ApiErrorModel` · `"apiErrorModel5"` [500] `ApiErrorModel` · `"apiErrorModel6"` [502] `ApiErrorModel` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `EntoleApiClient.CancelLimitOrderRequest` (1):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `id` | `path` | `string` | yes |

| Type | Schema value | Source |
| --- | --- | --- |
| `MandateView` | `mandateViewSchema` | `src/models/mandate-view.ts` |
| `ApiErrorModel` | `apiErrorModelSchema` | `src/models/api-error-model.ts` |

### createLimitOrder

- **Signature**: `createLimitOrder(request: EntoleApiClient.CreateLimitOrderRequestParams, options?: RequestOptions): ApiPromise<CreatedLimitOrder, EntoleApiClient.CreateLimitOrderError>`
- **Wire**: `POST /api/mandates`
- **Auth**: `bearer`
- **Request body**: `application/json` — the `body` field
- **SDK-sent**: `header Idempotency-Key` (minted per call)
- **Returns**: `CreatedLimitOrder`
- **Error**: `EntoleApiError` with `kind: "api"`, an instance of `EntoleApiClient.CreateLimitOrderError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"apiErrorModel"` [400] `ApiErrorModel` · `"apiErrorModel2"` [401] `ApiErrorModel` · `"apiErrorModel3"` [422] `ApiErrorModel` · `"apiErrorModel4"` [429] `ApiErrorModel` · `"apiErrorModel5"` [500] `ApiErrorModel` · `"apiErrorModel6"` [502] `ApiErrorModel` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `EntoleApiClient.CreateLimitOrderRequestParams` (1):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `body` | `body` | `CreateLimitOrderRequest` | yes |

| Type | Schema value | Source |
| --- | --- | --- |
| `CreateLimitOrderRequest` | `createLimitOrderRequestSchema` | `src/models/create-limit-order-request.ts` |
| `CreatedLimitOrder` | `createdLimitOrderSchema` | `src/models/created-limit-order.ts` |
| `ApiErrorModel` | `apiErrorModelSchema` | `src/models/api-error-model.ts` |

### getAp2Mandates

- **Signature**: `getAp2Mandates(request: EntoleApiClient.GetAp2MandatesRequest, options?: RequestOptions): ApiPromise<Ap2Export, EntoleApiClient.GetAp2MandatesError>`
- **Wire**: `GET /api/mandates/{id}/ap2`
- **Auth**: `bearer`
- **Request body**: none — no `Content-Type` header is sent
- **Returns**: `Ap2Export`
- **Error**: `EntoleApiError` with `kind: "api"`, an instance of `EntoleApiClient.GetAp2MandatesError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"apiErrorModel"` [401] `ApiErrorModel` · `"apiErrorModel2"` [403] `ApiErrorModel` · `"apiErrorModel3"` [404] `ApiErrorModel` · `"apiErrorModel4"` [429] `ApiErrorModel` · `"apiErrorModel5"` [500] `ApiErrorModel` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `EntoleApiClient.GetAp2MandatesRequest` (1):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `id` | `path` | `string` | yes |

| Type | Schema value | Source |
| --- | --- | --- |
| `Ap2Export` | `ap2ExportSchema` | `src/models/ap2-export.ts` |
| `ApiErrorModel` | `apiErrorModelSchema` | `src/models/api-error-model.ts` |

### getCurrentUser

- **Signature**: `getCurrentUser(options?: RequestOptions): ApiPromise<Me, EntoleApiClient.GetCurrentUserError>`
- **Wire**: `GET /api/me`
- **Auth**: `bearer`
- **Request body**: none — no `Content-Type` header is sent
- **Returns**: `Me`
- **Error**: `EntoleApiError` with `kind: "api"`, an instance of `EntoleApiClient.GetCurrentUserError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"apiErrorModel"` [401] `ApiErrorModel` · `"apiErrorModel2"` [429] `ApiErrorModel` · `"apiErrorModel3"` [500] `ApiErrorModel` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

| Type | Schema value | Source |
| --- | --- | --- |
| `Me` | `meSchema` | `src/models/me.ts` |
| `ApiErrorModel` | `apiErrorModelSchema` | `src/models/api-error-model.ts` |

### getLimitOrder

- **Signature**: `getLimitOrder(request: EntoleApiClient.GetLimitOrderRequest, options?: RequestOptions): ApiPromise<MandateView, EntoleApiClient.GetLimitOrderError>`
- **Wire**: `GET /api/mandates/{id}`
- **Auth**: `bearer`
- **Request body**: none — no `Content-Type` header is sent
- **Returns**: `MandateView`
- **Error**: `EntoleApiError` with `kind: "api"`, an instance of `EntoleApiClient.GetLimitOrderError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"apiErrorModel"` [401] `ApiErrorModel` · `"apiErrorModel2"` [403] `ApiErrorModel` · `"apiErrorModel3"` [404] `ApiErrorModel` · `"apiErrorModel4"` [429] `ApiErrorModel` · `"apiErrorModel5"` [500] `ApiErrorModel` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `EntoleApiClient.GetLimitOrderRequest` (1):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `id` | `path` | `string` | yes |

| Type | Schema value | Source |
| --- | --- | --- |
| `MandateView` | `mandateViewSchema` | `src/models/mandate-view.ts` |
| `ApiErrorModel` | `apiErrorModelSchema` | `src/models/api-error-model.ts` |

### listLimitOrders

- **Signature**: `listLimitOrders(options?: RequestOptions): ApiPromise<MandateSummary[], EntoleApiClient.ListLimitOrdersError>`
- **Wire**: `GET /api/mandates`
- **Auth**: `bearer`
- **Request body**: none — no `Content-Type` header is sent
- **Returns**: `MandateSummary[]` — a bare `application/json` array; the success type *is* the array, not a wrapper model
- **Error**: `EntoleApiError` with `kind: "api"`, an instance of `EntoleApiClient.ListLimitOrdersError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"apiErrorModel"` [401] `ApiErrorModel` · `"apiErrorModel2"` [429] `ApiErrorModel` · `"apiErrorModel3"` [500] `ApiErrorModel` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

| Type | Schema value | Source |
| --- | --- | --- |
| `MandateSummary` | `mandateSummarySchema` | `src/models/mandate-summary.ts` |
| `ApiErrorModel` | `apiErrorModelSchema` | `src/models/api-error-model.ts` |

### proposeExtraCheck

- **Signature**: `proposeExtraCheck(request: EntoleApiClient.ProposeExtraCheckRequest, options?: RequestOptions): ApiPromise<MandateView, EntoleApiClient.ProposeExtraCheckError>`
- **Wire**: `POST /api/mandates/{id}/schedule/propose`
- **Auth**: `bearer`
- **Request body**: `application/json` — the `body` field
- **SDK-sent**: `header Idempotency-Key` (minted per call)
- **Returns**: `MandateView`
- **Error**: `EntoleApiError` with `kind: "api"`, an instance of `EntoleApiClient.ProposeExtraCheckError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"apiErrorModel"` [400] `ApiErrorModel` · `"apiErrorModel2"` [401] `ApiErrorModel` · `"apiErrorModel3"` [403] `ApiErrorModel` · `"apiErrorModel4"` [404] `ApiErrorModel` · `"apiErrorModel5"` [409] `ApiErrorModel` · `"apiErrorModel6"` [422] `ApiErrorModel` · `"apiErrorModel7"` [429] `ApiErrorModel` · `"apiErrorModel8"` [500] `ApiErrorModel` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `EntoleApiClient.ProposeExtraCheckRequest` (2):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `id` | `path` | `string` | yes |
| `body` | `body` | `ProposeCheckRequest` | yes |

| Type | Schema value | Source |
| --- | --- | --- |
| `ProposeCheckRequest` | `proposeCheckRequestSchema` | `src/models/propose-check-request.ts` |
| `MandateView` | `mandateViewSchema` | `src/models/mandate-view.ts` |
| `ApiErrorModel` | `apiErrorModelSchema` | `src/models/api-error-model.ts` |

