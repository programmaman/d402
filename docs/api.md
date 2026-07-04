# d402 API Reference

This page summarizes the public package entry points. See the TypeScript types
in `src/` for exact definitions.

## `d402/core`

Shared protocol primitives.

```ts
import {
  hashPaymentTerms,
  parsePaymentProof,
  parsePaymentRequest,
} from "d402/core";
```

Exports:

- `hashPaymentTerms(terms)`: returns the deterministic `termsHash`.
- `parsePaymentRequest(value)`: validates and normalizes wire payment requests.
- `parsePaymentProof(value)`: validates and normalizes decoded payment proofs.

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

```ts
import {
  createD402Client,
  D402PaymentAction,
} from "d402/client";
```

### `createD402Client(options)`

Creates a client with a `fetch(input, init)` method.

Important options:

- `provider`: ethers provider used for chain/policy validation.
- `signer`: ethers signer used to create dPayment transactions.
- `factoryAddress`: optional dPayment factory override.
- `fetch`: optional fetch implementation. Defaults to global `fetch`.
- `proofHeaderName`: optional proof header override. Defaults to `D402-Payment-Proof`.
- `paymentConfirmations`: confirmations to wait after payment creation.
- `actionConfirmations`: confirmations to wait for settle/dispute/refund actions.
- `policy`: local spending policy.
- `onResponse`: validates the protected response before action handling.
- `onAccepted`: action after accepted protected response.
- `onRejected`: action after rejected protected response.
- `executor`: custom payment executor for tests or alternate payment creation.

### Client Policy

```ts
interface D402ClientPolicy {
  maxAmount?: bigint | string;
  allowedChains?: number[];
  allowedPayees?: Address[];
  allowedTokens?: Array<Address | null>;
  allowedResources?: Array<string | RegExp>;
  maxExpiryWindowSec?: number;
  maxSettlementWindowSec?: number;
  requireAgreementHash?: boolean;
}
```

Policy is checked before payment creation. Use it for both user-approved and
unattended signers.

### Payment Actions

```ts
D402PaymentAction.KeepOpen
D402PaymentAction.Settle
D402PaymentAction.RequestRefund
D402PaymentAction.Dispute
```

Accepted responses may `KeepOpen` or `Settle`.
Rejected responses may `KeepOpen`, `RequestRefund`, or `Dispute`.

## `d402/server`

Server-side payable routes and verification.

```ts
import {
  payable,
  createDPaymentsVerifier,
  paymentActions,
} from "d402/server";
```

### `payable(options)`

Wraps a request handler and returns a function that either:

- returns `402 application/d402+json` with payment terms, or
- verifies the proof and calls the protected handler.

Important options:

- `paymentConfig.provider`: ethers provider used for verification.
- `paymentConfig.resource`: string or function that returns the URL/resource being purchased.
- `paymentConfig.minConfirmations`: required payment transaction confirmations.
- `paymentConfig.settlementWindow`: derive settlement time from latest block timestamp.
- `paymentConfig.settlementTimeUnixSec`: explicit settlement time.
- `paymentConfig.cache`: latest-block cache for settlement-window derivation.
- `terms`: static terms or a function of the request.
- `handler`: protected handler.
- `verify`: optional custom verifier.
- `proofHeaderName`: optional proof header override.
- `buildPaymentRequiredResponse`: optional 402 response builder.

`paymentConfig.resource` should be set for payable routes. The current client
expects it to match the request URL it retries, so `resource: (request) =>
request.url` is the clearest default. If terms do not include a resource and
`paymentConfig.resource` is missing, request construction fails.

### `createDPaymentsVerifier(options)`

Creates the default on-chain verifier. It reads transaction receipts, decodes
dPayment events, reads live payment state, and checks the request/proof match.

### `paymentActions(options)`

Creates server-side action helpers:

```ts
const actions = paymentActions({ provider, signer });

await actions.settlePayment(paymentAddress);
await actions.refundPayment(paymentAddress);
await actions.submitEvidence(paymentAddress, "ipfs://QmEvidence");
await actions.appealPayment(paymentAddress);
```

## Custom Verifiers

Use a custom verifier to add app policy such as one-shot consumption,
account binding, or allowlists.

```ts
const baseVerifier = createDPaymentsVerifier({ provider, minConfirmations: 2 });

const verify: PaymentVerifier = async (input) => {
  const result = await baseVerifier(input);
  if (!result.ok) {
    return result;
  }

  const consumed = await db.payments.wasConsumed(input.proof.paymentAddress);
  if (consumed) {
    return { ok: false, reason: "payment-already-consumed" };
  }

  return result;
};
```

## `d402/autosigner`

The autosigner entry point currently exports no runtime API. It is reserved for
future automatic payment flows with separate budget and custody guardrails.
