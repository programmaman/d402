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
- `paymentSalt`: optional canonical salt selecting server-controlled payment
  identity. Omission selects client-controlled entropy.

The request does not carry `paymentId`, payer identity, or an EOA transaction
nonce. By default, `payable()` emits the canonical salt; configure
`paymentConfig.identifier: "client"` to omit it and let each client invocation
generate a fresh salt. The client derives `paymentId` from the normalized
request, actual signer address, and effective salt.

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

The server checks that:

- the proof parses and its salt derives the expected payment ID
- the transaction exists and succeeded
- the transaction emitted the expected dPayment `PaymentCreated` event
- the factory, payment address, payee, token, amount, and settlement time match
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
