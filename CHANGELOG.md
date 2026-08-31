# Changelog

All notable public changes to d402 are documented here.

## 0.5.0 - Unreleased

### Payment facilitation

- Payable routes can advertise available payment facilitators alongside their
  payment terms.
- Clients can select an advertised facilitator and submit a corresponding
  payment authorization through the d402 request flow.
- Facilitated payments return to d402's existing payment-proof verification
  path, while direct client payments remain supported.

### Integrations

- Updated the Ethers and Viem integrations to support payment workflows where
  signing and transaction submission are handled by different parties.
- Improved transaction execution reliability across client and server payment
  flows.
- Updated the Ethers and Viem adapter packages for the `0.5.0` release.

## 0.4.1 - 2026-08-28

### Runtime correctness

- Chain-dependent operations now read the current chain ID from the injected
  RPC client instead of reusing a value for the lifetime of the client or
  server component.
- The client no longer reads the chain ID during construction; policy checks
  read it when a payment challenge is received.
- Server payment observation now creates its chain-dependent reader using the
  current chain, so provider network changes are not hidden by stale state.
- Retained reuse of DPayments objects keyed by the current chain and wallet
  address.

## 0.4.0 - 2026-08-22

### Provider-neutral integration

- Removed d402 core's runtime dependency on ethers and viem.
- Standardized client and executor composition around four neutral capabilities:
  `rpcClient`, `codec`, `errorDecoder`, and `txSender`.
- Added the shared `D402Adapter` contract so applications can provide those
  capabilities through one provider-neutral adapter object.
- Retained custom payment executors for relayers, custodial wallets, and other
  integrations that do not use the standard dPayments execution path.

### Ethers and Viem adapters

- Added provider-specific Ethers and Viem adapter packages that supply the
  neutral d402 capabilities.
- Kept provider, signer, wallet, nonce, gas, receipt, and confirmation behavior
  inside the corresponding adapter transaction sender and RPC client.
- Added provider-specific error decoding at the adapter boundary.
- Reduced the default adapter package surface to the adapter, transaction
  sender, and Ethers compatibility client constructors.

### API cleanup

- Split payment configuration into `adapter` and `payment` sections. Routes,
  `paymentActions()`, verification, settlement, and refund helpers now share
  the same nested `{ adapter, payment }` composition API.
- Added `PaymentOptions` for confirmations, settlement timing, caching,
  identifiers, logging, events, and multicall settings.
- Removed client-side confirmation options. Transaction confirmation depth is
  now configured on the adapter transaction sender; server verification
  confirmations remain part of server payment configuration.
- Simplified `Once()` to accept only the payment actions it consumes.
- Removed unused provider-specific adapter type aliases and provider-specific
  dependencies from shared protocol code.
- Updated the public documentation and runnable examples for the new API.

## 0.3.3 - 2026-08-13

### Package security

- Replaced the synthetic URL base used by refund-route validation with
  reference-aware validation while preserving supported refund URL forms.

## 0.3.2 - 2026-08-13

### Package security

- Stopped shipping example application manifests in the npm package so package
  security scanners analyze only d402's runtime dependency surface.

## 0.3.1 - 2026-08-03

### Dependency security

- Updated PostCSS from 8.5.16 to 8.5.25 to address the audited source-map
  path-traversal vulnerability.
- Updated brace-expansion from 5.0.7 to 5.0.9 to address the audited
  uncontrolled resource-consumption vulnerability.
- Updated nanoid from 3.3.15 to 3.3.17 as part of the dependency audit.

## 0.3.0 - 2026-08-03

This is the stable V0.3 release. It promotes the APIs and protocol behavior
validated across the `0.3.0-rc.0` through `0.3.0-rc.4` release candidates.

### Production payment semantics

- Added protocol-level one-shot consumption so horizontally scaled server
  replicas can authorize a payment at most once without a shared replay cache,
  sticky sessions, or a centralized lock.
- Updated the pinned Gnosis Quick Disputable Payment integration to V2 at
  `0x2813C7F3c4AABBa045e10f1eFAc835E342DE4E0A` and re-enabled `Once()` against
  the deployed on-chain consumption implementation.
- Added standardized refund discovery, authenticated refund requests,
  application-owned refund policy, and reusable client/server refund APIs.
- Added `PaymentAuthorizer` for framework-owned controllers, middleware,
  services, and other integrations where payment authorization belongs outside
  a Fetch-native `payable()` wrapper.
- Added server- and client-selected payment identity, reusable payments,
  multiple payment schemes behind one HTTP protocol, and explicit verification
  policies for funded and settled payment states.

### Client reliability and integration

- Added recoverable `d402Fetch()` and `retry()` flows, persisted payment
  attempts, explicit payment actions, and structured post-payment errors.
- Added strict client policy validation for chains, tokens, payees, resources,
  amounts, expiry windows, and settlement windows.
- Added browser-compatible proof encoding and prepared-transaction events for
  wallet previews, observability, and application UX.
- Added consistent transaction failure normalization, bounded nonce retries,
  and optional structured logging across client and server actions.

### Protocol and documentation

- Finalized wire protocol version `0.3`, including canonical payment identity,
  compact proof transport, exact resource/method binding, and settlement
  references that fail closed on chain disagreement.
- Expanded production guidance for framework integration, CORS, scaling,
  refunds, payment schemes, recovery, observability, and signing.
- Added runnable examples demonstrating Fetch-native and framework-native
  authorization patterns.

## 0.3.0-rc.4 - 2026-08-01

### Prepared transaction events

- Added `D402Event`, `TransactionPreparedEvent`, and `D402EventHandler`.
- Added non-blocking event dispatch with isolated handler failures and
  non-awaited asynchronous work.
- Added cloned transaction snapshots
- Emitted prepared transaction events immediately before every signer attempt,
  including nonce retries.
- Forwarded `onEvent` through client executors, server payment actions, and
  payment configuration.

## 0.3.0-rc.3 - 2026-08-01

### Browser-compatible client proof encoding

- Decoupled client payment-proof encoding from Node's `node:buffer` module.
- Reused ethers UTF-8 and base64 utilities so `d402/client` can be bundled for
  browser wallet integrations while preserving the existing base64url proof
  format.

## 0.3.0-rc.2 - 2026-07-31

### Temporary Once blocker

- Temporarily disabled `Once()` with an explicit error until the on-chain
  consumption logic is updated. The blocker includes a TODO for removal. 
  On-chain upgrades need a CI / publish pipeline too.

## 0.3.0-rc.1 - 2026-07-31

### Client payment recovery

- Added `client.d402Fetch()` to return both the HTTP response and the completed
  `D402PaymentAttempt` used for a paid request.
- Added `client.retry()` to resend a persisted proof after validating request
  method, resource, freshness, and proof-header binding. Retrying never creates
  another payment.
- Exposed the client's resolved `executor` so integrators can explicitly run
  settlement or other supported payment actions.
- Added `D402PaymentError`, which preserves the completed payment attempt,
  original cause, and paid response when available after a post-payment
  failure.
- Kept `fetch()` as the response-only convenience API. `d402Fetch()` and
  `retry()` do not invoke response validation or automatic post-response
  actions, giving applications direct control over persistence and recovery.

### Client policy

- Client policy configuration is now validated during `createD402Client()`
  construction, before provider or network work.
- `maxAmount` must be a non-negative integer, `allowedChains` entries must be
  positive safe integers, and expiry and settlement windows must be
  non-negative safe integers.
- Stateful resource regular expressions now reset and restore `lastIndex`, so
  repeated policy evaluation is deterministic.

### Refund protocol and policy

- Added `D402RefundRoute` so payable routes can advertise a relative or
  absolute HTTP(S) refund endpoint in payment challenges.
- Standardized refund transport as an HTTP `POST` with content type
  `application/d402-refund+json`. `D402RefundRequest` carries the historical
  `D402PaymentRequest`, its `D402PaymentProof`, and an optional client-provided
  policy reason.
- `D402PaymentAction.RequestRefund` now sends the canonical refund request
  internally when a paid response is rejected. Refund endpoint failures surface
  as `D402PaymentError` with a `D402RefundRequestError` cause that retains the
  endpoint response.
- Added `client.requestRefund(payment, reason?)` for user-approved, delayed, or
  otherwise application-controlled use of the same canonical refund transport
  after `d402Fetch()`. The stored challenge route cannot be overridden.
- Added `refunder(routeConfig, refundPolicy)`. It reuses the original payable
  route's payment configuration to authenticate payment creation, verify that
  the configured signer controls the payee, observe current on-chain state,
  enforce funded-state eligibility, and broadcast the refund transaction.
- Added the application-owned `RefundPolicy` seam for HTTP caller
  authentication, order and fulfillment rules, refund windows, application
  idempotency, and manual review. d402 authenticates the payment; it does not
  define a protocol identity for the refund requester.
- Added the public `FundedPayment` and `FundedOrSettledPayment` verification
  policies. `refunder()` always applies `FundedPayment`, while
  `FundedOrSettledPayment` is the default policy for ordinary payable routes.
- Refund handling deliberately does not invoke the original terms resolver,
  recovery hook, consumer, protected handler, or route verification-policy
  override.

### Server verification and request handling

- Added `PaymentAuthorizer` for controller-owned and middleware-adapted request
  flows. It runs the same authorization pipeline as `payable()` and returns
  either a protocol response or the successful `PayableContext`.
- Split immutable proof and creation authentication, canonical live
  payment-state observation, and route-specific verification policy.
  `VerificationPolicy` can accept or reject an `ObservedPaymentContext`
  without replacing canonical proof authentication or observation.
- Added the authenticated-payment `recovery` hook between authentication and
  live-state verification, allowing applications to recover completed work
  before verification, consumption, or handler execution.
- Verification-error response builders now receive the complete
  `PaymentFailure`, including the original cause when available.
- Exported the canonical payment-required and verification-error response
  builders so custom response hooks can preserve the protocol body and content
  type while adding application headers.
- Updated consumer and handler contexts to carry authenticated payment data,
  verified state, and the consumer result without duplicating verification
  payloads.
- Moved server resource selection into `terms.resource`, which supports static
  values and dynamic resolvers.
- Added generic `PayableResolverContext<Req>`. Terms and resource resolvers
  receive independent body-safe request clones while
  `context.originalRequest` preserves framework-specific request properties
  such as `NextRequest.nextUrl`.
- Settlement references now fail closed when their block is unavailable or
  does not match the challenged block number, hash, or timestamp. Verification
  no longer substitutes newer chain data for an issued challenge.
- Removed the deprecated latest-block timestamp cache and legacy settlement
  resolver while retaining the block-reference settlement path.

### Transaction execution and observability

- Added the shared `D402PaymentExecutionError` for client and server payment
  actions. It preserves the original cause and exposes the operation, payment
  address, decoded dPayments revert name, and transaction error code when
  available.
- Consolidated client and server transaction failure normalization so contract
  reverts surface consistently instead of being hidden behind unrelated
  wrapper messages.
- Signer nonce selection remains owned by the configured signer. d402 does not
  wrap signers in `NonceManager`, assign explicit nonces, or share nonce state
  across independently created executors or action helpers.
- Each executor or action helper privately orders its own broadcasts. A
  `NONCE_EXPIRED` broadcast is freshly gas-estimated and retried up to three
  times with bounded exponential backoff and jitter; other failures are not
  automatically retried.
- Added an optional structured logger record sink to client and server payment
  execution. Logging is silent by default, logger failures are ignored, and
  contexts exclude signed transactions, credentials, evidence URIs, and
  arbitrary error properties.

### API and implementation cleanup

- Exported `defaultResponseValidator` and `BuildPaymentProofInput` for
  integrators composing the corresponding public client extension points.
- Removed `acceptSuccessfulResponse`, `D402ResponseValidationError`, and the
  dead `paymentProofSchema` alias.
- Payment action defaults are resolved once by `createD402Client()` rather than
  inside the lower-level response resolution helper.
- `parseD402PaymentProof()` now parses and normalizes directly from the complete
  proof schema while `parseDPaymentProof()` remains the standalone public
  dPayment-proof parser.
- Removed the client forwarding dPayments helper; execution now calls the
  pinned dPayments adapter directly without changing adapter caching or
  implementation pinning.

### Documentation

- Reworked the protocol reference around wire-level request flows, HTTP
  messages, and canonical error modes, removing SDK and deployment guidance.
- Expanded every payable pattern in the advanced guide to show both the
  Fetch-native `payable()` form and the equivalent framework-owned
  `PaymentAuthorizer` flow.
- Added separate runnable Express server files for `payable()` and
  `PaymentAuthorizer`, backed by the same terms and HTTP adapter for a direct
  integration comparison.
- Added production HTTP integration guidance for CORS, browser preflight,
  framework controllers, response decoration, and refund credentials.
- Added a scaling guide covering stateless cross-replica verification,
  on-chain and database replay claims, recovery storage, RPC capacity, and
  tested same-signer operation across replicas, with centralized nonce
  coordination described as an optional high-volume or custody architecture.

## 0.3.0-rc.0 - 2026-07-28

This prerelease contains the intended protocol and API surface for V0.3. The
stable `0.3.0` release remains pending production contract deployment and final
release verification.

### Payment identity

- Added server-selected payment identity through
  `paymentConfig.identifier: "server" | "client"`.
- Server identity is the default. The server emits the canonical d402 salt and
  identical terms from the same authenticated payer reconstruct the same
  payment ID.
- Client identity omits the request salt and the standard client generates
  fresh 32-byte entropy for each payment attempt.
- Application terms can no longer inject a payment salt.
- The server rejects canonical-salt disagreement before custom verification or
  RPC work.
- Payment IDs are derived from normalized payment terms, the payer
  authenticated by the canonical factory event, and the effective payment
  salt.

### Protocol

- Finalized wire protocol version `0.3`.
- Removed `paymentId` and `termsHash` from payment requests.
- Removed `paymentId` and `payerAddress` from transported proofs.
- Proofs carry the payment address, creation transaction hash, effective
  payment salt, and optional settlement reference.
- Reserved the canonical d402 salt for server identity so a client-identified
  payment cannot silently behave like a server-identified payment.
- Verification results now expose the payment creation block number and hash
  when available.

### Client and server APIs

- Added matching client and server resource resolvers for reverse proxies,
  gateways, and coordinated application namespaces.
- `paymentActions(config)` returns the reusable server `PaymentActions`
  interface, and `Once(actions)` receives that object instead of constructing
  payment actions from provider and signer options.
- Payment-request expiry is enforced even when client policy is omitted.
- A complete custom payment executor can run without an unused ethers provider
  when chain-dependent client policy is disabled.
- Exported custom executor options, client resource resolver types, and server
  verifier options.
- Retained exact URL and method binding as the default behavior.

### Integration patterns

- Documented server and client identity modes, reusable payments, canonical
  on-chain `Once` consumption, database-backed consumers, sponsored payments,
  deposits, refunds, escrow, metering, subscriptions, and asynchronous jobs.
- Canonical `Once` consumption can coordinate one-shot authorization across
  replicas without an application datastore, Redis lock, sticky session, or
  shared cache.
- Clarified that consumption is an at-most-once authorization claim, not an
  exactly-once handler or delivery guarantee.
- Updated shipped examples to use the V0.3 API and on-chain one-shot
  consumption.

### Upgrade note

- Upgrade d402 clients and servers together.
- Custom request or proof implementations must adopt the V0.3 identity and
  proof shapes.
- Use server identity for stable invoices, orders, and reusable entitlements.
- Use client identity when identical terms should permit independent payment
  attempts.

## 0.2.1

### Payment consumption

- Added one-shot payable routes through `consumer: Once({ provider, signer })`.
- Payable routes remain reusable by default and may state that policy explicitly
  with `consumer: None`.
- A verified payment is consumed before the protected handler runs. Replaying
  the same proof returns `422` with the non-retryable
  `payment-already-consumed` reason and does not invoke the handler again.
- Added the public `paymentActions().consumePayment(paymentAddress)` server
  action for integrators that need to consume payments outside payable routes.

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
