# d402 Protocol

d402 uses HTTP 402 as a payment challenge. The server describes the payment it
will accept, the client creates the matching dPayment, and the client
retries the request with a proof of payment creation.

## Request Flow

1. Client sends the original HTTP request.
2. Server returns `402 application/d402+json` when no usable proof is present.
3. Client parses `paymentRequest`.
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
interface PaymentRequiredResponseBody {
  paymentRequest: D402PaymentRequest;
  reason: PaymentRequiredReason;
}
```

The response uses `application/d402+json` rather than plain
`application/json` so clients can distinguish a d402 payment challenge from an
ordinary JSON error body. The `+json` suffix is intentional: generic JSON tools
can still parse it.

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

## Payment ID

`derivePaymentId(paymentRequest, payerAddress, effectivePaymentSalt)`:

1. Strictly parses and normalizes the payment request.
2. Removes `expiresAtUnixSec` and the request-level `paymentSalt`.
3. Requires a canonical request salt to equal the effective salt.
4. Requires a saltless request to use a noncanonical effective salt.
5. Adds the normalized, authenticated payer address and effective salt.
6. Serializes the resulting object with canonical JSON.
7. UTF-8 encodes the canonical JSON and hashes it with Keccak-256.


The identity object has this logical shape:

```ts
{
  ...normalizedPaymentRequestWithoutExpiryOrRequestSalt,
  payerAddress: normalizedAuthenticatedPayer,
  paymentSalt: normalizedEffectiveSalt,
}
```

Challenge expiration is deliberately excluded, so a refreshed challenge for
the same terms, payer, and salt retains its identity. The request-level
canonical salt selects server identity but is not hashed twice; the effective
salt is always included exactly once.

### Payment-ID vectors

Both vectors use these normalized terms and payer:

```json
{
  "paymentRequest": {
    "version": 0.3,
    "resource": "https://api.example.com/reports/123",
    "method": "GET",
    "chainId": 8453,
    "payeeAddress": "0x2222222222222222222222222222222222222222",
    "tokenAddress": null,
    "netAmount": "10000",
    "settlementTimeUnixSec": "1782600000",
    "agreement": {
      "id": "report:123:v1",
      "hash": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "uri": "ipfs://agreement"
    },
    "expiresAtUnixSec": 1782599700
  },
  "payerAddress": "0x5555555555555555555555555555555555555555"
}
```

Server identity adds the canonical request salt and uses that same effective
salt:

```json
{
  "effectivePaymentSalt": "0xf70865accd1b69835cd1ac81f96bc4351fa9e88b4cf76f91f0661ce3d15e2ac6",
  "paymentId": "0xb7cf1b368368d9ede156fcd25a1dc7ca4fb1533629412081e2c238d3158e8d20"
}
```

Client identity omits the request salt and uses fresh client entropy:

```json
{
  "effectivePaymentSalt": "0x7777777777777777777777777777777777777777777777777777777777777777",
  "paymentId": "0xb224b8743f42355ed43b9458b017c4d023cfe7147dccde54c675b3659b2af265"
}
```

Changing only `expiresAtUnixSec` leaves these identities unchanged. A
saltless request using the canonical salt, or a canonical request using another
effective salt, is invalid.

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

The proof does not claim `paymentId` or `payerAddress`. The server authenticates
the actual payer from the trusted factory's `PaymentCreated.creator` and derives
the expected ID from the request, authenticated creator, and proof salt.

When a challenge carries a `settlementReference`, the client echoes that exact
reference in its proof. Verification resolves the referenced block by hash and
rejects a missing or mismatched reference; it does not substitute a newer block
or reinterpret the settlement time.

The server checks that:

- the proof parses and its salt derives the expected payment ID
- the transaction exists and succeeded
- the transaction emitted the expected dPayment `PaymentCreated` event
- the factory, payment address, payee, token, amount, and settlement time match
- the live payment state is usable
- the configured confirmation count is met

## Confirmations and Reorganizations

One included creation receipt is one confirmation. At greater depths, the
built-in verifier calculates:

```text
observed head block - creation block + 1
```

Verification is relative to the canonical chain observed by the configured
provider at verification time. Confirmation depth reduces reorganization risk
but does not establish absolute finality. Applications requiring a stronger or
different finality rule can configure a greater depth or provide a custom
verifier.

The built-in verifier exposes its observation through
`VerifiedPayment.confirmations`, `creationBlockNumber`, and
`creationBlockHash`. Custom verifiers may omit this optional metadata.

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
| `wrong-amount` | The on-chain amount does not satisfy the built-in verifier. | `false` |
| `wrong-settlement-time` | The on-chain settlement time differs from the request. | `false` |
| `insufficient-confirmations` | Creation lacks the configured depth. | `true` |
| `failed-transaction` | The creation transaction reverted. | `false` |
| `missing-created-event` | No matching factory creation event was found. | `false` |
| `disputed-payment` | The payment is disputed and unavailable for normal access. | `false` |
| `resolved-payment` | The resolved payment is unavailable for normal access. | `false` |
| `provider-timeout` | Provider verification timed out. | `true` |
| `provider-error` | Provider verification failed. | `true` |

Custom verifier codes are returned unchanged and belong to the integrator's
own API contract. The table above defines the stable built-in meanings.

## Retryability

`retryable` is a non-authoritative SDK hint that the condition may succeed
after caller action or a later attempt. It does not prescribe whether to reuse
a proof, create another payment, request another challenge, or recover an
application result. The SDK surfaces the reason; application code owns the
recovery decision.
