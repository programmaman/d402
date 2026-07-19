# Changelog

All notable public changes to d402 are documented here.

## 0.2.0

### Payment flow

- Settlement-window payments remain stable when payment is delayed, retried, or
  interrupted by a temporary service outage.
- Settlement timing is based on the payment terms and the authenticated chain
  information associated with the payment, so a newer block does not silently
  change an existing payment.
- Clients can submit a complete payment proof on the first request when using
  ordinary `fetch()` or another compatible client.
- The automatic client continues to own challenge handling, payment creation,
  and its single paid retry. It does not automatically create another payment
  after a failed paid response.
- Challenge expiration now controls whether payment terms are offered; it does
  not invalidate an authenticated on-chain payment.
- Payment challenges and payment-verification failures are now separate
  responses. Only requests without a proof receive a payable `402` challenge.
- Proof-bearing failures use non-payable responses: `422` for permanent
  rejection, `425` while payment confirmation is pending, `503` for temporary
  provider unavailability, and `504` for provider timeouts.
- Callers may retry a pending or temporary failure with the same proof.
- Agreement IDs are documented as agreement-instance identifiers. Applications
  can include a request or order ID when each payment should be unique.

### API

- Unified confirmation configuration under `confirmations`.
- Payment resources default to the incoming request URL.
- The complete `D402PaymentProof` format is now the public proof format, with
  an optional settlement reference for window-based payments.
- `encodeD402PaymentProof`, `parseDPaymentProof`, and
  `parseD402PaymentProof` are the canonical proof APIs.
- Updated the public protocol version to `2`.
- Removed obsolete client settlement-window and confirmation option names.

### Reliability

- Payment verification remains valid across server restarts, replica changes,
  delayed retries, and blockchain reorgs, etc.
- Fixed-time payments do not require settlement-reference lookups.
- Window-based payments can continue when the referenced block is temporarily
  unavailable, provided the authenticated payment supplies sufficient chain
  evidence.

### Upgrade note

- Upgrade d402 clients and servers together before using this release in
  production.
- Applications using custom proof handling should switch from legacy flat proof
  payloads to the complete `D402PaymentProof` format.
- Applications should use `agreement.id` for a stable agreement instance ID;
  d402 does not generate a default agreement nonce.

## 0.1.5

### Changed

- **Breaking:** `payerAddress` is now required in payment proofs, created
  payment results, and verified payment results. Payer-less proofs are rejected
  as invalid before any RPC verification begins.
- Server verification authenticates `payerAddress` against the trusted
  `PaymentCreated.creator` event and reads only the payment's live `state()` on
  the normal access path.

### Performance

- Reduced normal verification RPC work by replacing full payment snapshot reads
  with a live state read after the creation event has been authenticated.
- Added provider- and chain-scoped reuse of connected chain metadata and SDK
  readers, plus in-flight deduplication for identical payment-state reads.
- Pruned receipt logs by factory address, event topic, payment ID, payer, and
  payee before decoding, with early exit after the matching creation event is
  found.
- Moved independent server resource resolution to run concurrently with
  settlement-term resolution while preserving deterministic settlement-error
  precedence.
- Shortened the client signer queue to preparation-free nonce assignment and
  transaction broadcast; confirmation waits now proceed outside the queue while
  ERC-20 approval-to-creation ordering remains enforced.
- Deduplicated concurrent identical payment-creation requests so they share one
  preparation and broadcast operation.
- Reduced request replay overhead by reusing the initial request and retaining
  only the retry clone.

## 0.1.4

### Payment reliability

- Normalized the default client payment and server verification threshold to
  one included block.
- Applications that omit `paymentConfig.minConfirmations` may now receive a
  temporary `402` response until the payment is included on-chain.

## 0.1.3

Released in the `0.1.3` release commit.

### Documentation

- Clarified the d402 documentation and public usage guidance.
- Updated README and package documentation to better describe the SDK.

### Maintenance

- Refined the package documentation following the `0.1.2` release.
- Kept the npm package lockfile and published package metadata aligned.

## 0.1.2

Released in the `0.1.2` release commit.

### API and architecture

- Simplified d402's public API and internal structure.
- Continued consolidating the SDK around the d402 payment flow.

### Publishing

- Added the repository URL to package metadata for npm publishing.
- Corrected package-lock synchronization for release publishing.

## 0.1.1

Released in the `0.1.1` release commit.

### Added

- Established the d402 package and HTTP 402 payment protocol implementation.
- Added client-side payment creation and signing flows.
- Added server-side payment verification and payment action support.
- Added support for the dPayments SDK and supported-chain configuration.
- Added CI and Apache 2.0 licensing.

### Payment reliability

- Adopted Quick Disputable Payments for the payment flow.
- Added signing guidance intended to prevent race conditions around ERC20
  transactions.

### Documentation

- Updated the project name and public README content to d402.
- Documented supported chains and native dPayment integration.