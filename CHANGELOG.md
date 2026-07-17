# Changelog

All notable public changes to d402 are documented here.

## 0.1.5

### Added

- Added facilitator support so servers can facilitate payment transactions on
  behalf of clients.

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
