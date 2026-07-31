# d402 Protocol

d402 uses HTTP 402 as a payment challenge. The server describes the payment it
will accept, the client creates the matching dPayment, and the client
retries the request with a proof of payment creation.

## Request Flow

1. Client sends the original HTTP request.
2. Server returns `402 application/d402+json` when no usable proof is present.
3. Client parses the complete `D402PaymentChallenge`.
4. Client validates local policy before spending.
5. Client creates the dPayment.
6. Client retries the same HTTP request with `D402-Payment-Proof`.
7. Server verifies the proof and on-chain payment state.
8. Server runs the protected handler.

## Payment Required Response

```http
HTTP/1.1 402 Payment Required
Content-Type: application/d402+json
Cache-Control: no-store
```

```ts
interface D402PaymentChallenge {
  paymentRequest: D402PaymentRequest;
  settlementReference?: D402BlockReference;
  reason: D402PaymentRequiredReason;
  refunds?: D402RefundRoute;
}

interface D402RefundRoute {
  url: string;
}

interface D402PaymentRequiredReason {
  code: "missing-proof";
  category: "proof" | "request" | "chain" | "policy";
  retryable: boolean;
  message?: string;
}

interface D402BlockReference {
  blockNumber: number;
  blockHash: `0x${string}`;
  blockTimestampUnixSec: `${bigint}`;
}
```

The response uses `application/d402+json` rather than plain
`application/json` so clients can distinguish a d402 payment challenge from an
ordinary JSON error body. The `+json` suffix is intentional: generic JSON tools
can still parse it. Window-based settlement challenges include
`settlementReference`; fixed-settlement challenges omit it.

`refunds.url` is optional advisory metadata pointing to an application-owned
refund-request destination. It may be relative or an absolute HTTP(S) URL.
The challenge itself does not define caller authorization or refund
eligibility. `RequestRefund` uses the fixed method and body described below;
the server's `RefundPolicy` owns application decisions. See
[Refunds](./refunds.md).

## Refund Request

The client sends `POST application/d402-refund+json` to the advertised refund
route:

```ts
interface D402RefundRequest {
  paymentRequest: D402PaymentRequest;
  paymentProof: D402PaymentProof;
  reason?: string;
}
```

The server authenticates the historical payment from these fields. It does not
resolve current terms or re-evaluate challenge expiration. The original HTTP
request and protected response are not part of the refund protocol.

A successful response contains the confirmed on-chain action result:

```ts
interface D402PaymentActionResult {
  txHash: `0x${string}`;
}
```

## Payment Request

```ts
interface D402PaymentRequest {
  version: 0.3;
  resource: string;
  method?: string;
  chainId: number;
  payeeAddress: `0x${string}`;
  tokenAddress: `0x${string}` | null;
  netAmount: `${bigint}`;
  settlementTimeUnixSec: `${bigint}`;
  agreement: {
    id: string;
    hash?: `0x${string}`;
    uri?: string;
  };
  expiresAtUnixSec: number;
  paymentSalt?:
    "0xf70865accd1b69835cd1ac81f96bc4351fa9e88b4cf76f91f0661ce3d15e2ac6";
}
```

Fields:

- `version`: current protocol version, `0.3`.
- `resource`: canonical identity of the protected operation or asset.
- `method`: optional HTTP method binding. When present, the client requires it
  to match the retried request method.
- `chainId`: EVM chain where the payment must be created.
- `payeeAddress`: recipient of the payment.
- `tokenAddress`: ERC-20 token address, or `null` for native token payments.
- `netAmount`: amount paid to the payee, as a decimal integer string.
- `settlementTimeUnixSec`: earliest settlement time, as Unix seconds.
- `agreement`: app-level agreement instance identifier and optional content hash/URI.
- `expiresAtUnixSec`: payment request expiry, as Unix seconds.
- `paymentSalt`: a protocol discriminator with exactly two valid states. The
  canonical salt is present for server-controlled identity; omission selects
  client-controlled entropy.

The request does not carry `paymentId`, payer identity, or an EOA transaction
nonce. By default, `payable()` emits the canonical salt; configure
`paymentConfig.identifier: "client"` to omit it and let each client invocation
generate a fresh salt. The client derives `paymentId` from the normalized
request, actual signer address, and effective salt.

## Payment ID

Use `derivePaymentId(paymentRequest, payerAddress, paymentSalt)` from
`d402/core` when an integration needs a payment ID. The SDK owns the
normalization and validation rules; applications should not reimplement them.

The two request forms are strict:

- `identifier: "server"` makes the server inject a canonical salt. The
  client must use that exact value and echo it in the proof.
- `identifier: "client"` makes the server omit `paymentSalt`. The client must
  generate a fresh 32-byte salt and then carry
  that value in the proof.

Application terms cannot provide `paymentSalt`. A saltless request paired with
the canonical proof salt is invalid, as is a canonical request paired with any
other proof salt. Salt selection occurs once when the payment is created;
confirmation waits and paid-request retries reuse the created payment's salt.

## Payment Proof

The client retries with a proof header:

```http
D402-Payment-Proof: <base64url-json>
```

Decoded proof shape:

```ts
interface D402PaymentProof {
  dPaymentProof: {
    version: 0.3;
    paymentAddress: `0x${string}`;
    txHash: `0x${string}`;
    paymentSalt: `0x${string}`;
  };
  settlementReference?: {
    blockNumber: number;
    blockHash: `0x${string}`;
    blockTimestampUnixSec: `${bigint}`;
  };
}
```

## Confirmations and Reorganizations

Verification is relative to the canonical chain observed by the configured
provider at verification time. Confirmation depth reduces reorganization risk
but does not establish absolute finality. Applications requiring a stronger or
different finality rule can configure a greater depth. Route-specific acceptance
rules belong in a custom verification policy.

The canonical observer exposes authenticated creation metadata through
`ObservedPayment.confirmations`, `creationBlockNumber`, and
`creationBlockHash`. A custom verification policy cannot replace or omit this
observation.

## Consumption

`Once` atomically consumes a verified payment before invoking the protected
handler. It guarantees at-most-once acquisition of that payment's authorization
across callers using the same on-chain consumer.

It does not guarantee exactly-once handler execution or result delivery. A
process can crash after consumption succeeds but before the handler completes.
Applications requiring recovery must provide their own idempotency, durable
result storage, job identity, or result endpoint. These are not protocol
requirements.

## Evidence

For the complete dispute lifecycle and responsibility boundaries, see
[Disputes](disputes.md).

Evidence storage is outside the d402 core protocol. Applications that need to
submit dispute evidence should use
[`@rakelabs/evidence-publisher`](https://www.npmjs.com/package/@rakelabs/evidence-publisher)
or provide an equivalent evidence-storage integration. The publisher produces
the evidence manifest and a content-addressed URI; d402 submits that URI
on-chain through `actions.submitEvidence(paymentAddress, evidenceUri)`, where
`actions` is returned by `paymentActions({ provider, signer })`.

This keeps IPFS and pinning-provider concerns out of the payment SDK while
allowing applications to publish evidence before submitting its URI. Until a
canonical d402 evidence-manifest schema is finalized, applications should
include their payment and resource binding in the published evidence content
and retain the returned publication metadata alongside the payment record.

## Failure Reasons

Built-in `reason.code` values:

| Code | Meaning | Current hint |
| --- | --- | --- |
| `missing-proof` | A payment proof is required. | `true` |
| `invalid-proof` | Proof transport or schema is invalid. | `false` |
| `missing-settlement-reference` | Window-based terms require a reference in the proof. | `false` |
| `reference-block-mismatch` | The referenced block does not match canonical chain data. | `false` |
| `reference-settlement-out-of-bounds` | Creation does not satisfy the reference settlement bounds. | `false` |
| `reference-provider-error` | Reference verification is temporarily unavailable. | `true` |
| `payment-id-mismatch` | Request and proof identity inputs disagree. | `false` |
| `onchain-payment-not-found` | The creation transaction is not currently observable. | `true` |
| `onchain-payment-mismatch` | On-chain creation data is internally inconsistent. | `false` |
| `onchain-payment-not-usable` | The payment state cannot authorize access. | `false` |
| `payment-already-consumed` | Single-use authorization was already claimed. | `false` |
| `unsupported-chain` | The configured dPayments deployment does not support the requested chain. | `false` |
| `wrong-chain` | The configured provider observes another chain. | `false` |
| `wrong-factory` | Creation did not come from the trusted factory. | `false` |
| `wrong-payment-address` | The proof address does not match creation. | `false` |
| `wrong-payee` | The on-chain payee differs from the request. | `false` |
| `wrong-token` | The on-chain token differs from the request. | `false` |
| `wrong-amount` | The on-chain amount does not satisfy the authenticated request. | `false` |
| `wrong-settlement-time` | The on-chain settlement time differs from the request. | `false` |
| `insufficient-confirmations` | Creation lacks the configured depth. | `true` |
| `failed-transaction` | The creation transaction reverted. | `false` |
| `missing-created-event` | No matching factory creation event was found. | `false` |
| `disputed-payment` | The payment is disputed and unavailable for normal access. | `false` |
| `resolved-payment` | The resolved payment is unavailable for normal access. | `false` |
| `provider-timeout` | Provider verification timed out. | `true` |
| `provider-error` | Provider verification failed. | `true` |

Custom verification-policy codes are returned unchanged and belong to the integrator's
own API contract. The table above defines the stable built-in meanings.

## Retryability

`retryable` is a non-authoritative SDK hint that the condition may succeed
after caller action or a later attempt. It does not prescribe whether to reuse
a proof, create another payment, request another challenge, or recover an
application result. The SDK surfaces the reason; application code owns the
recovery decision.
