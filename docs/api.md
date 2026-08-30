# d402 API Reference

This page summarizes the public package entry points. See the TypeScript types
in `src/` for exact definitions.

## Client vs Server

d402 splits responsibility cleanly:

- client: evaluate the 402, create the payment, retry with proof, then keep the
  payment open, settle, dispute, or request a refund after the response
- server: verify the proof and run any configured consumption or lifecycle
  action before handing the verified payment to application code

The client exposes completed payment attempts so applications can persist and
retry proof delivery after a client-side paid-request failure. Server-side
fulfillment recovery remains a server concern.

See [HTTP and Framework Integration](./http-integration.md) for CORS,
middleware, and credentials, and [Scaling d402](./scaling.md) for replicated
deployment architecture.

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

- `D402PaymentRequest`
- `D402PaymentChallenge`
- `D402PaymentRequiredReason`
- `D402PaymentProof`
- `D402PaymentActionResult`
- `D402RefundRoute`
- `D402Agreement`
- `Address`
- `Hex32`
- `DecimalString`
- `PaymentAddress`
- `PreparedTx`: an unsigned transaction produced by the dPayments SDK.
- `SignedTx`: an opaque serialized signed transaction.
- `D402Signer`: obtains the payer address and signs `PreparedTx` values.
- `D402TxBroadcaster`: submits `SignedTx` values and returns
  `D402BroadcastResult`.
- `D402BroadcastResult`: a successful pending submission or a classified
  retryable/non-retryable broadcast failure.

## `d402/client`

Paying client.

Client responsibility:

- evaluate a 402 payment request against local policy
- create the payment transaction
- retry the original request with a proof
- optionally keep open, settle, dispute, or request a refund after the protected
  response is received

The client may request a refund through the advertised standard endpoint. The
server still owns refund authorization and execution.

```ts
import {
  createD402Client,
  defaultResponseValidator,
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
- `requestRefund(payment, reason?)`: sends the canonical refund request to the
  endpoint advertised with that payment attempt.

```ts
interface D402FetchResponse {
  response: Response;
  payment?: D402PaymentAttempt;
}

interface D402PaymentAttempt {
  paymentRequest: D402PaymentRequest;
  payment: D402CreatedPayment;
  proof: D402PaymentProof;
  refunds?: D402RefundRoute;
}
```

`client.executor` is the executor the client uses. When `executor` is supplied
to `createD402Client()`, it is the same instance. When the client creates the
default executor from `signer` and `broadcaster`, that created instance is
exposed there instead. This makes explicit payment actions available in either
setup:

```ts
const { response, payment } = await client.d402Fetch(url);

if (response.ok && payment !== undefined) {
  await client.executor.settlePayment!(payment.payment);
}
```

Use `requestRefund()` after `d402Fetch()` when the application needs user
approval, delayed execution, or another decision before using the standard
refund transport:

```ts
const { response, payment } = await client.d402Fetch(url);

if (payment !== undefined && await approveRefund(response)) {
  await client.requestRefund(payment, "User approved refund");
}
```

The method uses only the refund route retained from the original challenge. It
does not accept a route or transport override. It throws
`D402ConfigurationError` when the payment has no advertised refund route and
`D402RefundRequestError` when the endpoint rejects the request or returns an
invalid result.

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
no response. `fetch()` also uses this error if response validation or an
automatic post-response action fails. `d402Fetch()` and `retry()` never invoke
response validation or take payment actions.

Important options:

- `rpcClient`: chain reader used for policy checks and payment preparation.
- `codec`: ABI codec used by the default executor and payment actions.
- `errorDecoder`: optional provider-error decoder.
- `signer`: `D402Signer` used to obtain the payer address and sign prepared
  dPayment transactions.
- `broadcaster`: `D402TxBroadcaster` used to submit signed transactions.
- `fetch`: optional fetch implementation. Defaults to global `fetch`.
- `proofHeaderName`: optional proof header override. Defaults to `D402-Payment-Proof`.
- `confirmations`: confirmation depth used for payment creation and server actions.
- `policy`: local spending policy.
- `onResponse`: post-response validator used before automatic accepted or
  rejected actions. The canonical `defaultResponseValidator` is exported for
  custom validators that want to delegate to the default HTTP-status decision.
- `onAccepted`: action after accepted protected response.
- `onRejected`: action after a rejected protected response.
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
D402PaymentAction.RequestRefund
D402PaymentAction.Dispute
```

Accepted responses may `KeepOpen` or `Settle`.
Rejected responses may `KeepOpen`, `RequestRefund`, or `Dispute`.
`RequestRefund` uses the standard advertised refund route. Use
`d402Fetch()` followed by explicit `requestRefund()` when the application needs
to decide later.

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

### `Facilitator`

`Facilitator` is the native signed-transaction relay. It accepts a `SignedTx`,
passes it to `D402TxBroadcaster.broadcastTx()`, and returns the resulting
`D402BroadcastResult`. It does not inspect, sign, construct, or retry the
transaction. Retry requires the original `PreparedTx` and payer signer, so it
belongs to normal d402 runtime execution rather than this relay.

```ts
const facilitator = new Facilitator(serverAdapter.broadcaster!);
const result = await facilitator.facilitate(signedTx);
```

```ts
import {
  Facilitator,
  payable,
  None,
  Once,
  paymentActions,
} from "d402/server";
```

Server configuration is shared across routes and actions:

```ts
interface PaymentConfig {
  adapter: D402Adapter;
  payment: PaymentOptions;
}
```

### `payable(options)`

Wraps a request handler and returns a function that either:

- returns `402 application/d402+json` with payment terms, or
- verifies the proof and calls the protected handler.

Important options:

- `adapter`: provider-neutral chain capabilities used for verification and
  optional server actions.
- `payment.confirmations`: required payment transaction confirmations.
- `payment.settlementWindow`: optional settlement window in seconds for
  dynamic relative settlement timing.
- `payment.settlementTimeUnixSec`: explicit settlement time.
- `payment.cache`: optional cache setting for settlement-window support.
- `payment.logger`: optional structured record sink for server payment
  actions. It has the same failure-isolated behavior as the client logger.
- `payment.multicall`: optional trusted Multicall3 configuration used by
  canonical payment-state observation.
- `terms`: static terms or a function of the request. Its optional `resource`
  may be a string or function of the request; it defaults to the incoming URL.
- `handler`: protected handler.
- `refunds`: optional application-owned refund destination included
  in the 402 challenge as `{ url }`. Automatic and explicit standard refund
  requests use this destination.
- `recovery`: optional authenticated-payment recovery hook. A response returned
  here skips live-state verification, consumption, and the handler.
- `verificationPolicy`: optional policy that accepts or rejects a canonically
  observed payment. It cannot replace proof authentication or live-state
  observation. `FundedOrSettledPayment` is the default; the exported
  `FundedPayment` accepts only payments whose current state is `funded`.
- `consumer`: optional payment-consumption policy. Use
  `Once(actions)` with a shared `paymentActions({ adapter, payment })` instance
  to consume a verified payment before the
  protected handler runs, or `None` to state the reusable policy explicitly.
  Routes are reusable by default. `Once` is an at-most-once authorization
  claim, not an exactly-once handler or delivery guarantee.
- `proofHeaderName`: optional proof header override.
- `buildPaymentRequiredResponse`: optional 402 response builder.
- `buildPaymentVerificationErrorResponse`: optional proof-bearing failure
  response builder.

The canonical `buildPaymentRequiredResponse()` and
`buildPaymentVerificationErrorResponse()` implementations are exported from
`d402/server`. Custom builders can delegate to them and add application headers
without reimplementing the protocol body or content type.

The resource defaults to the incoming request URL. When using another stable
identifier, configure `terms.resource` on the server and `resource` on the
client to resolve the same opaque string.

Terms and resource callbacks receive a body-safe clone as their first argument
and a `PayableResolverContext<Req>` as their second:

```ts
interface PayableResolverContext<
  Req extends Request = Request,
> {
  readonly originalRequest: Req;
  readonly bodyRequest: Request;
}
```

`originalRequest` is the exact request passed to the payable route, preserving
framework-specific properties such as `NextRequest.nextUrl`. `bodyRequest` is
the same clone passed as the callback's first argument. Terms and resource
callbacks receive separate clones, so each can read the body without consuming
the handler's request. Existing one-argument callbacks retain their clone-based
behavior.

### `paymentActions(config)`

Creates a `PaymentActions` object containing the server-side lifecycle methods:

```ts
const actions = paymentActions({
  adapter,
  payment: { confirmations: 1 },
});

await actions.settlePayment(paymentAddress);
await actions.refundPayment(paymentAddress);
await actions.consumePayment(paymentAddress);
await actions.submitEvidence(paymentAddress, "ipfs://QmEvidence");
await actions.appealPayment(paymentAddress);
```

The configuration contains the provider-neutral `adapter` and the server
`payment` options. The adapter must expose both `signer` and `broadcaster` for
server payment actions.
Reuse the returned object for payable consumers, lifecycle workers, and recovery
flows that use that configuration.

`paymentActions()` creates an independent action object for each call. Each
object privately orders its own broadcasts, while nonce selection remains
entirely with the configured signer. Independent helpers and server processes
can share one wallet; d402's bounded fresh-estimation retry handles normal
nonce races. External coordination remains optional for sustained high-volume
traffic or centralized custody.

d402 does not wrap client or server signers in ethers `NonceManager`. When a
broadcast result reports a retryable nonce conflict, d402 makes up to three
fresh signing attempts using bounded exponential backoff with jitter. The
adapter classifies provider-specific errors; the runtime owns retry policy and
never re-broadcasts the same signed transaction. Other provider, signer, and
contract failures are not automatically retried.

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
      transactionError: error.transactionError, // for example "NONCE_EXPIRED"
    });
  }
}
```

`dpaymentsError` is present only when the dPayments revert is recognized.
`transactionError` contains a machine-readable transaction or provider error
code when one is available. Provider, signer, and unknown contract failures
still use the normalized execution error with the original failure available
through `cause`.

## Recovery and Consumers

d402 always authenticates payment creation and observes current on-chain state.
`recovery` runs before observation, so an application can return a stored result
before replay consumption. A custom `VerificationPolicy` receives the
`ObservedPaymentContext` produced by canonical observation; use it when a route
intentionally permits or rejects a particular current payment state. Use
`PaymentConsumer` for single-use or application claims.

`Once` accepts any object implementing the `consumePayment` portion of
`PaymentActions`. Use the concrete actions object for canonical on-chain
consumption:

```ts
const actions = paymentActions({
  adapter,
  payment: { confirmations: 1 },
});
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
  ...paymentConfig,
  consumer: databaseOnce,
  terms,
  handler,
});
```

Do not implement consumption as a policy read followed by a later write.
That check is not atomic and permits concurrent replay.

## Refund routes and policy

`D402PaymentAction.RequestRefund` sends a `D402RefundRequest` containing the
historical payment request, payment proof, and rejection reason to the
advertised `D402RefundRoute`.

`client.requestRefund(payment, reason?)` exposes the same canonical transport
for an application-controlled decision after `d402Fetch()`. There is no refund
transport callback or route override.

On the server, `refunder(originalRouteConfig, refundPolicy)` authenticates the
payment, verifies signer ownership and refundable state, applies application
policy, and calls the existing on-chain refund action. `RefundPolicy` is the
only application plugin in this flow. See [Refunds](./refunds.md).

## `d402/autosigner`

The autosigner entry point currently exports no runtime API. It is reserved for
future automatic payment flows with separate budget and custody guardrails.
