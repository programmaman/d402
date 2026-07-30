# d402 API Reference

This page summarizes the public package entry points. See the TypeScript types
in `src/` for exact definitions.

## Client vs Server

d402 splits responsibility cleanly:

- client: evaluate the 402, create the payment, retry with proof, then keep the
  payment open or settle after the response
- server: verify the proof and run any configured consumption or lifecycle
  action before handing the verified payment to application code

The client exposes completed payment attempts so applications can persist and
retry proof delivery after a client-side paid-request failure. Server-side
fulfillment recovery remains a server concern.

d402 handles the payment handshake and on-chain verification. Your app still
owns the business decision after verification: what was purchased, whether the
payment can be reused, how fulfillment is recorded, and when settlement or
refund should happen.

## `d402/core`

Shared protocol primitives.

```ts
import {
  derivePaymentId,
  parseDPaymentProof,
  parseD402PaymentProof,
  parsePaymentRequest,
} from "d402/core";
```

Exports:

- `derivePaymentId(request, payerAddress, paymentSalt)`: derives the v0.3
  identity after strict normalization and salt-agreement checks.
- `parsePaymentRequest(value)`: validates and normalizes wire payment requests.
- `parseDPaymentProof(value)`: validates and normalizes an underlying dPayment proof.
- `parseD402PaymentProof(value)`: validates and normalizes a complete d402 payment proof.

Key types:

- `D402PaymentTerms`
- `D402PaymentRequest`
- `D402PaymentProof`
- `D402Agreement`
- `Address`
- `Hex32`
- `DecimalString`
- `PaymentAddress`

## `d402/client`

Paying client.

Client responsibility:

- evaluate a 402 payment request against local policy
- create the payment transaction
- retry the original request with a proof
- keep the payment open or settle it after the protected response is received

The client does not own server-side lifecycle recovery. Refund handling and
other post-response recovery flows belong to the server side.

```ts
import {
  createD402Client,
  D402PaymentAction,
  D402PaymentError,
  type D402Logger,
} from "d402/client";
```

### `createD402Client(options)`

Creates a client with these request methods:

- `fetch(input, init)`: a compatibility convenience that returns `Response`.
- `d402Fetch(input, init)`: returns the HTTP response plus the payment attempt
  when a payment was required. It does not invoke `onResponse` or perform a
  payment action.
- `retry(payment, input, init)`: resends an existing payment proof. It validates
  the request binding and never creates another payment.

```ts
interface D402FetchResponse {
  response: Response;
  payment?: D402PaymentAttempt;
}

interface D402PaymentAttempt {
  paymentRequest: D402PaymentRequest;
  payment: D402CreatedPayment;
  proof: D402PaymentProof;
}
```

`client.executor` is the executor the client uses. When `executor` is supplied
to `createD402Client()`, it is the same instance. When the client creates the
default executor from `signer` and `provider`, that created instance is exposed
there instead. This makes explicit payment actions available in either setup:

```ts
const { response, payment } = await client.d402Fetch(url);

if (response.ok && payment !== undefined) {
  await client.executor.settlePayment!(payment.payment);
}
```

Use `d402Fetch()` when a completed payment must be recoverable:

```ts
try {
  const { response, payment } = await client.d402Fetch(url);
  if (payment !== undefined) await savePaymentAttempt(payment);
  return response;
} catch (error) {
  if (error instanceof D402PaymentError) {
    await savePaymentAttempt(error.payment);
    return (await client.retry(error.payment, url)).response;
  }
  throw error;
}
```

`D402PaymentError` is thrown only after a payment and proof have been created.
It exposes `payment`, the original `cause`, and `response` when a paid HTTP
response was received before the failure. For example, a transport failure has
no response. `fetch()` also uses this error if its legacy response validation
or automatic payment action fails. `d402Fetch()` and `retry()` never invoke
those callbacks or take payment actions.

Important options:

- `provider`: ethers provider used by the default executor and chain policy.
  It is optional when a complete custom executor is supplied without policy.
- `signer`: ethers signer used to create dPayment transactions.
- `fetch`: optional fetch implementation. Defaults to global `fetch`.
- `proofHeaderName`: optional proof header override. Defaults to `D402-Payment-Proof`.
- `confirmations`: confirmation depth used for payment creation and server actions.
- `policy`: local spending policy.
- `onResponse`: advanced post-response validator used before auto-settle handling.
- `onAccepted`: action after accepted protected response.
- `onRejected`: escape hatch for unusual client-side behavior after a rejected response.
- `executor`: custom payment executor for tests or alternate payment creation.
- `logger`: optional structured record sink for payment execution. It is silent
  by default, and exceptions or rejected promises from the logger are ignored.
- `resource`: optional stable resource string or resolver. Defaults to the
  retried request URL and should match the server's resource configuration.

### Client Policy

```ts
interface D402ClientPolicy {
  maxAmount?: bigint | string;
  allowedChains?: number[];
  allowedPayees?: Address[];
  allowedTokens?: Array<Address | null>;
  allowedResources?: Array<string | RegExp>;
  maxExpiryWindowSec?: number;
  minSettlementWindowSec?: number;
  requireAgreementHash?: boolean;
}
```

Policy is checked before payment creation. Use it for both user-approved and
unattended signers. `minSettlementWindowSec` rejects terms whose absolute
settlement time is too close to the current time; it is an optional payer-side
safety policy, not a protocol requirement. Challenge expiration and
resource/method binding are always checked, even when no policy is configured.

The local configuration is checked when `createD402Client()` is constructed:
`maxAmount` must be a non-negative integer, every `allowedChains` entry must
be a positive safe integer, and both expiry and settlement windows must be
non-negative safe integers. This happens before provider or network work.

### Client Actions

```ts
D402PaymentAction.KeepOpen
D402PaymentAction.Settle
```

Accepted responses may `KeepOpen` or `Settle`.
Rejected responses are typically kept open. If your app needs recovery after a
rejected response, handle that on the server side. `onRejected` is an escape
hatch, not a primary application flow.

### Logging

Both `d402/client` and `d402/server` export these types:

```ts
type D402Logger = (record: D402LogRecord) => void | Promise<void>;

interface D402LogRecord {
  level: "debug" | "info" | "error";
  event: string;
  message: string;
  context?: Readonly<Record<string, unknown>>;
}
```

The logger is a record sink rather than an adapter for a particular logging
library. d402 does not write to the console when it is omitted. It catches
both synchronous logger errors and rejected logger promises. Context is
limited to lifecycle identifiers such as action, payment ID/address, wallet
address, transaction hash, and safe error name/code/message; it excludes
signed transactions, credentials, evidence URIs, and arbitrary error objects.

## `d402/server`

Server-side payable routes and verification.

Server responsibility:

- verify payment proofs and on-chain state
- run settlement, refund, consumption, evidence, or appeal actions with a server signer

```ts
import {
  payable,
  None,
  Once,
  paymentActions,
} from "d402/server";
```

### `payable(options)`

Wraps a request handler and returns a function that either:

- returns `402 application/d402+json` with payment terms, or
- verifies the proof and calls the protected handler.

Important options:

- `paymentConfig.provider`: ethers provider used for verification.
- `paymentConfig.confirmations`: required payment transaction confirmations.
- `paymentConfig.settlementWindow`: optional settlement window in seconds for
  dynamic relative settlement timing.
- `paymentConfig.settlementTimeUnixSec`: explicit settlement time.
- `paymentConfig.cache`: optional cache setting for settlement-window support.
- `paymentConfig.logger`: optional structured record sink for server payment
  actions. It has the same failure-isolated behavior as the client logger.
- `terms`: static terms or a function of the request. Its optional `resource`
  may be a string or function of the request; it defaults to the incoming URL.
- `handler`: protected handler.
- `recovery`: optional authenticated-payment recovery hook. A response returned
  here skips live-state verification, consumption, and the handler.
- `verifier`: optional verifier for an authenticated payment. It may accept or
  reject the current payment state, but cannot replace proof authentication.
- `consumer`: optional payment-consumption policy. Use
  `Once(actions)` with a shared `paymentActions({ provider, signer })` instance
  to consume a verified payment before the
  protected handler runs, or `None` to state the reusable policy explicitly.
  Routes are reusable by default. `Once` is an at-most-once authorization
  claim, not an exactly-once handler or delivery guarantee.
- `proofHeaderName`: optional proof header override.
- `buildPaymentRequiredResponse`: optional 402 response builder.

The resource defaults to the incoming request URL. When using another stable
identifier, configure `terms.resource` on the server and `resource` on the
client to resolve the same opaque string.

### `paymentActions(config)`

Creates a `PaymentActions` object containing the server-side lifecycle methods:

```ts
const actions = paymentActions({ provider, signer });

await actions.settlePayment(paymentAddress);
await actions.refundPayment(paymentAddress);
await actions.consumePayment(paymentAddress);
await actions.submitEvidence(paymentAddress, "ipfs://QmEvidence");
await actions.appealPayment(paymentAddress);
```

The configuration requires `provider` and `signer`; `confirmations` is
optional. Reuse the returned object for payable consumers, lifecycle workers,
and recovery flows that use that configuration.

`paymentActions()` currently creates an independent action object for each
call. Retain and share that object where one configured signer is used by
routes and workers.

Client and server on-chain payment failures use the same
`D402PaymentExecutionError` constructor, exported from both `d402/client` and
`d402/server`. It preserves the original error as `cause` and exposes stable
execution context:

```ts
try {
  await actions.settlePayment(paymentAddress);
} catch (error) {
  if (error instanceof D402PaymentExecutionError) {
    console.error({
      code: error.code,                   // "D402_PAYMENT_EXECUTION_FAILED"
      operation: error.operation,         // "settle"
      paymentAddress: error.paymentAddress,
      dpaymentsError: error.dpaymentsError, // for example "InvalidState"
    });
  }
}
```

`dpaymentsError` is present only when the dPayments revert is recognized.
Provider, signer, and unknown contract failures still use the normalized
execution error with the original failure available through `cause`.

## Recovery and Consumers

d402 always authenticates payment creation and verifies current on-chain
identity. `recovery` runs before verification, so an application can return a
stored result before replay consumption. A custom verifier receives only this
authenticated context; use it when a route intentionally permits or rejects a
particular current payment state. Use `PaymentConsumer` for single-use or
application claims.

`Once` accepts any object implementing the `consumePayment` portion of
`PaymentActions`. Use the concrete actions object for canonical on-chain
consumption:

```ts
const actions = paymentActions({ provider, signer });
const consumer = Once(actions);
```

A custom database consumer must claim the payment atomically:

```ts
import type { PaymentConsumer } from "d402/server";

const databaseOnce: PaymentConsumer = {
  async consume({ payment }) {
    const inserted = await db.consumedPayments.insertIfAbsent({
      chainId,
      paymentId: payment.paymentId,
      paymentAddress: payment.paymentAddress,
    });

    return inserted
      ? { ok: true, result: undefined }
      : { ok: false, reason: "payment-already-consumed" };
  },
};

const route = payable({
  paymentConfig,
  verify,
  consumer: databaseOnce,
  terms,
  handler,
});
```

Do not implement consumption as a verifier read followed by a later write.
That check is not atomic and permits concurrent replay.

## `d402/autosigner`

The autosigner entry point currently exports no runtime API. It is reserved for
future automatic payment flows with separate budget and custody guardrails.
