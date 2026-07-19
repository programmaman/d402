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
  version: 2;
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
  termsHash: `0x${string}`;
  paymentId: `0x${string}`;
}
```

Fields:

- `version`: current protocol version, `2`.
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
- `termsHash`: deterministic hash of the payment terms.
- `paymentId`: equal to `termsHash`; used as the dPayment ID.

`paymentId` is deterministic. Identical payment terms produce identical payment
IDs. Include distinct `resource` or `agreement.id` metadata when each order,
session, or purchase needs a unique payment. For request-specific agreements,
the integrator should provide a stable identifier such as
`report-access:v1:${requestId}`. d402 does not generate a default nonce.

## Payment Proof

The client retries with a proof header:

```http
D402-Payment-Proof: <base64url-json>
```

Decoded proof shape:

```ts
interface D402PaymentProof {
  version: 2;
  paymentId: `0x${string}`;
  paymentAddress: `0x${string}`;
  txHash: `0x${string}`;
  payerAddress: `0x${string}`;
}
```

`payerAddress` is required. It is the account recorded as `creator` by the
trusted factory's `PaymentCreated` event. The value supplied by the client is
not trusted on its own: the server accepts it only after the receipt event's
`creator` matches it.

The server checks that:

- the proof parses and matches the expected payment ID
- the transaction exists and succeeded
- the transaction emitted the expected dPayment `PaymentCreated` event
- the factory, payment address, payee, token, amount, settlement time, and payer match
- the live payment state is usable
- the configured confirmation count is met

## Evidence

For the complete dispute lifecycle and responsibility boundaries, see
[Disputes](disputes.md).

Evidence storage is outside the d402 core protocol. Applications that need to
submit dispute evidence should use
[`@rakelabs/evidence-publisher`](https://www.npmjs.com/package/@rakelabs/evidence-publisher)
or provide an equivalent evidence-storage integration. The publisher produces
the evidence manifest and a content-addressed URI; d402 submits that URI
on-chain through `paymentActions().submitEvidence(paymentAddress, evidenceUri)`.

This keeps IPFS and pinning-provider concerns out of the payment SDK while
allowing applications to publish evidence before submitting its URI. Until a
canonical d402 evidence-manifest schema is finalized, applications should
include their payment and resource binding in the published evidence content
and retain the returned publication metadata alongside the payment record.

## Failure Reasons

Common `reason.code` values:

- `missing-proof`
- `invalid-proof`
- `payment-request-expired`
- `payment-id-mismatch`
- `onchain-payment-not-found`
- `unsupported-chain`
- `wrong-chain`
- `wrong-factory`
- `wrong-payment-address`
- `wrong-payee`
- `wrong-token`
- `wrong-amount`
- `wrong-settlement-time`
- `wrong-payer`
- `insufficient-confirmations`
- `failed-transaction`
- `missing-created-event`
- `disputed-payment`
- `resolved-payment`
- `provider-error`

Unknown custom verifier codes are treated as policy failures and returned to
the client with `category: "policy"`.

## Retryability

`retryable: true` means the client may try again after changing inputs or
waiting. Examples: missing proof, invalid proof, expired request, provider
error, insufficient confirmations.

`retryable: false` means repeating the same payment is not expected to help.
Examples: wrong payee, wrong token, wrong amount, disputed payment, resolved
payment.

The SDK surfaces these reasons; application code decides how to display or
recover from them.
