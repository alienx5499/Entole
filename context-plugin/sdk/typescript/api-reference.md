# Reference

> Source: [EntoleApiClient](src/client.ts)

<details>
<summary><code>cancelLimitOrder(request: EntoleApiClient.CancelLimitOrderRequest, options?: RequestOptions): ApiPromise&lt;MandateView, EntoleApiClient.CancelLimitOrderError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Shares the money limit of 20 calls a minute per user. If the PayPal void has failed 3 times, the answer is `502 release_failed`.

</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.cancelLimitOrder({ id: "mandate_3f9c2a71-8d4e-4b6a-9c1e-5a7b2d8e4f10" });
  // TODO: Handle 'response' of type MandateView
} catch (err) {
  // TODO: Handle 'err' of type EntoleApiClient.CancelLimitOrderError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.cancelLimitOrder({
  id: "mandate_3f9c2a71-8d4e-4b6a-9c1e-5a7b2d8e4f10",
}).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type MandateView
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>id</code> | <code>string</code> | The limit order id. |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.cancelLimitOrder(request)`

- **OnSuccess**: <code>[MandateView](src/models/mandate-view.ts)</code>
- **OnError**: throws <code>[EntoleApiClient.CancelLimitOrderError](src/client.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.cancelLimitOrder(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;MandateView, EntoleApiClient.CancelLimitOrderError&gt;</code>, with `result.value` of type <code>[MandateView](src/models/mandate-view.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[EntoleApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>createLimitOrder(request: EntoleApiClient.CreateLimitOrderRequestParams, options?: RequestOptions): ApiPromise&lt;CreatedLimitOrder, EntoleApiClient.CreateLimitOrderError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

The shopping agent shortlists up to 3 items that fit the terms, and Entole creates a PayPal order for a hold of `limitPrice`. Nothing is held or paid until the human opens `approveUrl` and approves in PayPal. Limited to 10 calls a minute per user (`rate_limited`), 30 a day per user (`daily_limit_reached`) and 500 a day in total (`service_daily_limit_reached`).

</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.createLimitOrder({
    body: {
      query: "Dyson V15 Detect vacuum",
      brands: ["Dyson"],
      avoid: ["refurbished"],
      requiredAttributes: { Color: "Yellow/Nickel" },
      limitPrice: "450.00",
      validDays: 3,
      demoInjection: true,
      replay: true,
    },
  });
  // TODO: Handle 'response' of type CreatedLimitOrder
} catch (err) {
  // TODO: Handle 'err' of type EntoleApiClient.CreateLimitOrderError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.createLimitOrder({
  body: {
    query: "Dyson V15 Detect vacuum",
    brands: ["Dyson"],
    avoid: ["refurbished"],
    requiredAttributes: { Color: "Yellow/Nickel" },
    limitPrice: "450.00",
    validDays: 3,
    demoInjection: true,
    replay: true,
  },
}).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type CreatedLimitOrder
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>body</code> | <code>[CreateLimitOrderRequest](src/models/create-limit-order-request.ts)</code> | The terms the human will sign: what to buy, the most to pay and how many days to watch. They are hashed into the order's digest, so they cannot change after approval. |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.createLimitOrder(request)`

- **OnSuccess**: <code>[CreatedLimitOrder](src/models/created-limit-order.ts)</code>
- **OnError**: throws <code>[EntoleApiClient.CreateLimitOrderError](src/client.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.createLimitOrder(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;CreatedLimitOrder, EntoleApiClient.CreateLimitOrderError&gt;</code>, with `result.value` of type <code>[CreatedLimitOrder](src/models/created-limit-order.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[EntoleApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>getAp2Mandates(request: EntoleApiClient.GetAp2MandatesRequest, options?: RequestOptions): ApiPromise&lt;Ap2Export, EntoleApiClient.GetAp2MandatesError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Unsigned AP2 claim sets, served as a JSON download, so an agent can hand the order to another agent. `checkoutMandate` and `paymentMandate` stay null until the one capture.

</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.getAp2Mandates({ id: "mandate_3f9c2a71-8d4e-4b6a-9c1e-5a7b2d8e4f10" });
  // TODO: Handle 'response' of type Ap2Export
} catch (err) {
  // TODO: Handle 'err' of type EntoleApiClient.GetAp2MandatesError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.getAp2Mandates({
  id: "mandate_3f9c2a71-8d4e-4b6a-9c1e-5a7b2d8e4f10",
}).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type Ap2Export
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>id</code> | <code>string</code> | The limit order id. |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.getAp2Mandates(request)`

- **OnSuccess**: <code>[Ap2Export](src/models/ap2-export.ts)</code>
- **OnError**: throws <code>[EntoleApiClient.GetAp2MandatesError](src/client.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.getAp2Mandates(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;Ap2Export, EntoleApiClient.GetAp2MandatesError&gt;</code>, with `result.value` of type <code>[Ap2Export](src/models/ap2-export.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[EntoleApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>getCurrentUser(options?: RequestOptions): ApiPromise&lt;Me, EntoleApiClient.GetCurrentUserError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Read only: returns the user who owns the bearer token and the brands, avoids and attributes Entole saved from their funded orders (`taste` is null until one order was funded). It moves no money and changes nothing. Like every route it shares the per-IP limit of 240 calls a minute (`rate_limited`).

</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.getCurrentUser();
  // TODO: Handle 'response' of type Me
} catch (err) {
  // TODO: Handle 'err' of type EntoleApiClient.GetCurrentUserError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.getCurrentUser().asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type Me
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.getCurrentUser()`

- **OnSuccess**: <code>[Me](src/models/me.ts)</code>
- **OnError**: throws <code>[EntoleApiClient.GetCurrentUserError](src/client.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.getCurrentUser().asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;Me, EntoleApiClient.GetCurrentUserError&gt;</code>, with `result.value` of type <code>[Me](src/models/me.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[EntoleApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>getLimitOrder(request: EntoleApiClient.GetLimitOrderRequest, options?: RequestOptions): ApiPromise&lt;MandateView, EntoleApiClient.GetLimitOrderError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Read only: the full view of one order the token's owner created, with its signed terms, shortlist, PayPal hold amounts, the purchase once the watcher bought, the PayPal receipt and every audit entry. `approveUrl` is always null here. It moves no money; another user's order is `403 forbidden`. Like every route it shares the per-IP limit of 240 calls a minute (`rate_limited`).

</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.getLimitOrder({ id: "mandate_3f9c2a71-8d4e-4b6a-9c1e-5a7b2d8e4f10" });
  // TODO: Handle 'response' of type MandateView
} catch (err) {
  // TODO: Handle 'err' of type EntoleApiClient.GetLimitOrderError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.getLimitOrder({
  id: "mandate_3f9c2a71-8d4e-4b6a-9c1e-5a7b2d8e4f10",
}).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type MandateView
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>id</code> | <code>string</code> | The limit order id. |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.getLimitOrder(request)`

- **OnSuccess**: <code>[MandateView](src/models/mandate-view.ts)</code>
- **OnError**: throws <code>[EntoleApiClient.GetLimitOrderError](src/client.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.getLimitOrder(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;MandateView, EntoleApiClient.GetLimitOrderError&gt;</code>, with `result.value` of type <code>[MandateView](src/models/mandate-view.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[EntoleApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>listLimitOrders(options?: RequestOptions): ApiPromise&lt;MandateSummary[], EntoleApiClient.ListLimitOrdersError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

One summary row per order; call `getLimitOrder` for the full view.

</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.listLimitOrders();
  // TODO: Handle 'response' of type MandateSummary[]
} catch (err) {
  // TODO: Handle 'err' of type EntoleApiClient.ListLimitOrdersError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.listLimitOrders().asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type MandateSummary[]
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.listLimitOrders()`

- **OnSuccess**: <code>[MandateSummary](src/models/mandate-summary.ts)[]</code>
- **OnError**: throws <code>[EntoleApiClient.ListLimitOrdersError](src/client.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.listLimitOrders().asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;MandateSummary[], EntoleApiClient.ListLimitOrdersError&gt;</code>, with `result.value` of type <code>[MandateSummary](src/models/mandate-summary.ts)[]</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[EntoleApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>proposeExtraCheck(request: EntoleApiClient.ProposeExtraCheckRequest, options?: RequestOptions): ApiPromise&lt;MandateView, EntoleApiClient.ProposeExtraCheckError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

The proposal moves nothing: the human accepts or rejects it on the schedule page. With no `at`, the watcher picks a time 5, 15 or 45 minutes ahead from how close the best known price is to the limit. Shares the check-now limit of 60 calls a minute per order.

</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.proposeExtraCheck({
    id: "mandate_3f9c2a71-8d4e-4b6a-9c1e-5a7b2d8e4f10",
    body: {
      at: new Date(Date.UTC(2026, 9, 13, 18, 0, 0)),
      reason: "Home Depot often drops vacuum prices in the evening",
    },
  });
  // TODO: Handle 'response' of type MandateView
} catch (err) {
  // TODO: Handle 'err' of type EntoleApiClient.ProposeExtraCheckError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.proposeExtraCheck({
  id: "mandate_3f9c2a71-8d4e-4b6a-9c1e-5a7b2d8e4f10",
  body: {
    at: new Date(Date.UTC(2026, 9, 13, 18, 0, 0)),
    reason: "Home Depot often drops vacuum prices in the evening",
  },
}).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type MandateView
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>id</code> | <code>string</code> | The limit order id. |
| <code>body</code> | <code>[ProposeCheckRequest](src/models/propose-check-request.ts)</code> | When to check and why. Send `{}` to let the watcher pick the time and write the reason. |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.proposeExtraCheck(request)`

- **OnSuccess**: <code>[MandateView](src/models/mandate-view.ts)</code>
- **OnError**: throws <code>[EntoleApiClient.ProposeExtraCheckError](src/client.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.proposeExtraCheck(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;MandateView, EntoleApiClient.ProposeExtraCheckError&gt;</code>, with `result.value` of type <code>[MandateView](src/models/mandate-view.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[EntoleApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

