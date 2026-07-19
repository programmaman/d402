# d402 Compared With x402

This document compares d402 with x402 as payment protocols for protected
internet resources. Visa Trusted Agent Protocol (TAP) is discussed separately
because it operates at a different layer: TAP identifies and authenticates
agents and related consumer artifacts, while d402 and x402 define how payment
requirements and payment material are exchanged and verified.

The comparison is based on the public x402 documentation and repository and
Visa's public TAP documentation as available on July 18, 2026:

- [x402 introduction](https://docs.x402.org/introduction)
- [x402 client/server flow](https://docs.x402.org/core-concepts/client-server)
- [x402 facilitator model](https://docs.x402.org/core-concepts/facilitator)
- [x402 protocol repository](https://github.com/x402-foundation/x402)
- [x402 v2 HTTP transport](https://github.com/x402-foundation/x402/blob/main/specs/transports-v2/http.md)
- [Visa TAP specifications](https://developer.visa.com/capabilities/trusted-agent-protocol/trusted-agent-protocol-specifications/)
- [Visa TAP getting started guide](https://developer.visa.com/capabilities/trusted-agent-protocol/docs)

## Executive summary

x402 and d402 share the same broad HTTP shape:

```text
request without payment
  -> 402 payment requirements
  -> client prepares payment material
  -> client retries the request
  -> server verifies payment
  -> protected response
```

They differ in what the payment material represents and what the server learns
from it.

| Protocol | Primary question answered |
| --- | --- |
| x402 | Has the client supplied a payment payload accepted by the selected payment scheme and verifier or facilitator? |
| d402 | Was a payment matching these exact resource terms created on-chain, and is that payment currently usable? |

x402 is the broader interoperability framework. It supports multiple payment
schemes, networks, transports, facilitators, extensions, and settlement models.

d402 is the narrower payment-agreement protocol. It binds a specific HTTP
resource and optional method to deterministic payment terms, identifies those
terms with `paymentId`, and verifies an already-created dPayment and its live
on-chain state before invoking the protected handler.

The practical tradeoff is breadth versus an opinionated payment lifecycle:

```text
x402
  broader scheme and network interoperability
  authorization and settlement may be delegated
  guarantees depend on the selected scheme

d402
  one explicit dPayment-backed agreement model
  payment exists before protected access is granted
  open payment can later be settled, refunded, disputed, or resolved
```

Neither protocol proves that a merchant fulfilled a request correctly, nor
does either protocol decide whether an agent made a wise purchase. Applications
still own entitlement, fulfillment, one-shot consumption, quotas, and recovery
policy.

## Shared protocol foundation

Both protocols:

- use HTTP `402 Payment Required` to advertise payment requirements;
- let automated clients evaluate those requirements and retry with payment
  material;
- can support on-chain payments and machine-to-machine commerce;
- separate payment verification from application fulfillment;
- require application policy for one-shot access and business idempotency;
- can be used with an identity or agent-attestation layer such as TAP.

The meaningful comparison is therefore not "HTTP 402 versus HTTP 402." It is
the payment contract carried by the HTTP exchange.

## Payment model

### x402: a scheme-specific payment payload

x402 defines common envelopes such as `PaymentRequired`, `PaymentPayload`, and
`SettlementResponse`. The selected `(scheme, network)` implementation defines
the actual payment semantics.

For example, the x402 `exact` EVM scheme commonly carries a signed token
authorization containing an amount, recipient, validity interval, and nonce.
A facilitator or local implementation verifies the authorization and submits
or settles the payment. Other schemes can implement usage-based charging,
batch settlement, different chains, or different authorization models.

This architecture gives x402 substantial reach. It also means that statements
such as "an x402 payment is final," "an x402 payment is escrowed," or "an x402
payment is directly verifiable" cannot be made from the core envelope alone.
Those guarantees belong to the selected scheme, network implementation, and
settlement path.

### d402: an already-created payment agreement

d402 defines one narrower model around a dPayment object. The payment terms
include:

- resource;
- optional HTTP method;
- chain;
- payee;
- token;
- amount;
- settlement time;
- expiry;
- agreement identity and optional agreement evidence.

The normalized terms are hashed. The resulting `termsHash` is also the
`paymentId`. The client creates the corresponding dPayment and retries with a
proof containing the payment ID, payment address, creation transaction hash,
and payer address.

The server authenticates the creation transaction and `PaymentCreated` event,
checks the payment fields against the expected terms, checks confirmation
depth, and reads current payment state before protected access is granted.

This gives d402 a durable application-facing payment identity. The same
payment object can be recorded with fulfillment data and later settled,
refunded, disputed, or resolved.

## Resource and terms binding

d402 makes resource binding part of its core payment identity. The client
checks that the payment request's resource equals the URL it will retry and,
when present, that the method matches the original request. The server rebuilds
the same terms and checks the proof's payment ID before on-chain verification.

The binding is therefore:

```text
resource + method + payment terms + agreement
  -> deterministic termsHash
  -> paymentId
  -> authenticated PaymentCreated event
  -> verified protected request
```

x402 v2 also carries resource information and echoes the selected payment
requirements in `PaymentPayload`. Its core is deliberately extensible, so the
strength and exact shape of resource binding depend on the transport, scheme,
server implementation, and any extensions in use.

This is not evidence that x402 lacks binding. It is a difference in where the
guarantee lives: d402 fixes it in one payment-ID construction, while x402 lets
schemes and implementations define broader payment behavior.

## Deterministic settlement reconstruction

d402 supports two settlement modes:

- fixed settlement uses an absolute `settlementTimeUnixSec`;
- window settlement derives the absolute time from an immutable block
  reference plus a configured window.

For a window challenge, the selected block number, hash, and timestamp travel
from the `402` response into the complete d402 proof. A proof-bearing request
reconstructs the original terms from that preserved reference instead of
reading the current latest block.

This makes payment verification independent of:

- block advancement;
- challenge-cache expiry or eviction;
- process restarts;
- server replicas;
- sticky sessions;
- a distributed challenge store.

Cache state can improve performance, but it is not required to preserve the
meaning of an outstanding payment challenge.

x402's common exact-authorization flow generally avoids this particular issue
by signing an absolute authorization validity interval rather than deriving a
payment ID from a moving latest-block timestamp. The protocols solve timing at
different layers; d402's preserved reference is specifically required by its
block-relative settlement-window feature.

## Verification and settlement

### x402

x402 standardizes facilitator interfaces for verification and settlement. A
resource server can delegate chain-specific work to a facilitator or implement
the same operations locally.

This can reduce resource-server complexity and support gas sponsorship,
multiple networks, multiple schemes, and specialized settlement services. It
also introduces a verifier or facilitator boundary whose guarantees depend on
deployment and scheme configuration.

### d402

d402's default server directly verifies public chain evidence for the dPayment:

1. Check the configured chain.
2. Retrieve the creation transaction receipt.
3. Require a successful transaction and sufficient confirmations.
4. Authenticate the expected factory `PaymentCreated` event.
5. Check payer, payee, token, amount, settlement time, payment address, and
   payment ID.
6. Read the current payment state.
7. Invoke the protected handler only when the payment is usable.

A custom verifier may add account binding, one-shot consumption, quotas, or
other application policy, but it must not weaken the payment/request binding
unless the application deliberately accepts a different trust model.

## Failure semantics and retry behavior

d402 reserves payable `402` responses for requests that do not contain a
payment proof:

| Situation | d402 response |
| --- | --- |
| No proof | `402` with payable terms |
| Permanently invalid proof or payment | `422` without payable terms |
| Payment receipt or confirmations still pending | `425` without payable terms |
| Provider temporarily unavailable | `503` without payable terms |
| Provider timeout | `504` without payable terms |

Once a proof is present, d402 never issues a replacement payment challenge.
For `425`, `503`, or `504`, the caller may retry the same proof. This prevents a
verification failure from being misinterpreted as an instruction to create a
second payment.

The x402 v2 HTTP transport distinguishes malformed payment from payment
failure, but its documented mapping permits payment verification or settlement
failure to return `402`. That is a reasonable fit for a general paywall and
scheme framework, but automated clients must inspect the x402 response and
scheme-specific error rather than treating every `402` as an unconditional
instruction to authorize another payment.

## Statelessness and operational state

Both protocols can avoid storing the original HTTP challenge, but they do so
for different reasons.

x402 payment payloads echo the selected requirements and carry the
scheme-specific authorization or transaction material needed by the verifier.
A resource server may still depend on facilitator state, authorization nonce
consumption, settlement queues, or scheme-specific duplicate-settlement state.

d402 proof verification is stateless with respect to challenge issuance. The
complete proof carries the preserved settlement reference needed to reconstruct
window terms. Any server replica with the same route configuration and chain
access can verify the proof, even if it did not issue the original `402`.

"Stateless verification" does not mean "no state anywhere." d402 still relies
on chain state, and applications may require durable state for one-shot
consumption, fulfillment records, quotas, and recovery jobs.

## Replay and duplicate use

x402 signed authorization schemes commonly use a nonce and expiry to prevent
the same authorization from being settled repeatedly. That nonce protects the
payment authorization; it does not by itself prove that one settled payment
may unlock only one application operation.

d402 identifies an already-created payment by `paymentId`, payment address, and
creation transaction. Presenting the same valid proof again identifies the same
payment rather than creating a new payment. That also does not, by itself,
define whether access is one-shot or reusable.

For one-shot access, both systems need an atomic application decision such as:

```text
verified payment identity
  -> insert consumption record if absent
  -> only the successful insert may fulfill
```

d402 deliberately leaves that policy to the application because reusable
payments, subscriptions, quotas, and one-shot purchases have different
entitlement semantics.

## Payment lifecycle and recovery

d402's strongest product distinction is that payment remains an explicit
stateful agreement after the HTTP response. A funded payment can remain open
while fulfillment is evaluated and may later be:

- settled;
- voluntarily refunded;
- disputed;
- supported with evidence;
- appealed or resolved according to the dPayment contract lifecycle.

This is useful when fulfillment can fail, quality can be disputed, or the
payment should not become final merely because an HTTP handler returned.

x402 supports a wider variety of scheme-level settlement models, including
immediate exact payment, usage-based payment, and batch settlement. Those can
be better fits for inexpensive calls, high throughput, variable charges, or
multi-network interoperability. Recovery and dispute guarantees depend on the
chosen scheme and application rather than one universal x402 lifecycle.

## Performance and deployment tradeoffs

x402 can offer a shorter or more flexible application path when a signed
authorization is verified before a facilitator submits settlement. It can also
delegate RPC management, transaction submission, gas handling, and network
differences to facilitator infrastructure. Batch and usage-based schemes can
amortize settlement cost across many operations.

d402 creates the on-chain payment before the paid retry succeeds. That gives
the server strong public evidence before fulfillment, but it places transaction
inclusion and confirmation latency on the critical payment path.

The stateless correctness design removes avoidable infrastructure from that
path:

- proof-bearing requests never select a new latest block;
- fixed-settlement routes require no reference lookup;
- block references can be cached by immutable hash;
- concurrent lookups can be singleflighted;
- server replicas require no shared challenge store;
- invalid proofs can be rejected before unnecessary payment-state reads.

The right performance comparison therefore depends on the desired guarantee:
x402 can optimize authorization and settlement through pluggable schemes,
while d402 optimizes direct verification of an already-created payment object.

## Where x402 is the better fit

x402 is generally the stronger choice when the application needs:

- broad chain and token support;
- standardized facilitator interoperability;
- multiple payment schemes;
- gas sponsorship or relayed settlement;
- variable or usage-based charging;
- batch settlement for repeated micropayments;
- multiple transports such as HTTP, MCP, or A2A;
- ecosystem discovery and extension support.

Its abstraction is intentionally broader than d402's dPayment lifecycle.

## Where d402 is the better fit

d402 is generally the stronger choice when the application needs:

- one deterministic payment identity for exact resource terms;
- direct verification against public on-chain evidence;
- an already-created payment before protected code runs;
- restart-safe and replica-safe proof verification;
- an explicit open-payment lifecycle;
- settlement, refund, dispute, evidence, and appeal workflows;
- a durable payment object to associate with fulfillment records;
- precise distinction between payable challenges, permanent failures, pending
  payments, and provider failures.

Its guarantees are narrower, but more uniform because every d402 route uses the
same underlying payment model.

## Visa TAP composes with either payment protocol

Visa TAP should not be treated as a third competing payment protocol in this
comparison. TAP primarily provides agent recognition, signed request
artifacts, consumer or device identity, payment-container artifacts, and a
Visa-governed key and onboarding model.

Its primary question is:

```text
Who is this agent, what identity or delegation artifacts did it present, and
does the verifier recognize those artifacts?
```

That is complementary to d402's question:

```text
Was this exact payment agreement funded, and is the payment currently usable?
```

It is also complementary to x402's scheme-specific payment verification.

### TAP on top of d402

A TAP-enabled d402 service can process the layers independently:

```text
incoming request
  -> verify TAP agent and consumer artifacts
  -> apply agent authorization policy
  -> issue or reconstruct d402 payment terms
  -> verify the d402 payment proof and on-chain state
  -> apply application entitlement and fulfillment policy
```

TAP artifacts may travel in their own HTTP headers while d402 continues using
its payment challenge and `D402-Payment-Proof` header. No change to d402's core
payment verification is required merely to authenticate the agent.

If the application needs the TAP authorization to be cryptographically bound
to one exact payment agreement, it should bind a canonical identity or
authorization digest into the d402 agreement:

```text
canonical TAP authorization
  -> digest or server-side authorization record
  -> request-specific agreement.id and/or agreement.hash
  -> d402 termsHash
  -> paymentId
```

The application must then verify that the TAP request and the agreement binding
still match before fulfillment. d402's automatic client currently validates
the challenged resource and method against the retried HTTP request; it does
not interpret TAP artifacts. TAP verification therefore belongs in application
middleware, terms resolution, or a custom verifier.

### TAP on top of x402

The same layering is possible with x402. TAP can authenticate or classify the
agent before the resource server accepts an x402 payment payload. The x402
scheme still determines payment authorization and settlement, while the
application combines agent policy with the verified payment result.

The architectural boundary is:

| Layer | Responsibility |
| --- | --- |
| TAP | Agent recognition, identity artifacts, delegation, and network trust |
| d402 or x402 | Payment requirements, payment material, and payment verification |
| Application | Entitlement, one-shot consumption, fulfillment, quotas, and recovery |

## Threat-model comparison

| Threat or failure | x402 | d402 | Optional TAP contribution |
| --- | --- | --- | --- |
| Payment payload altered in transit | Scheme verification rejects invalid signed or encoded payment material | Terms hash, proof binding, and on-chain event checks reject mismatches | Signed TAP-covered request fields provide an additional integrity layer |
| Client pays the wrong recipient or amount | Depends on wallet policy and selected scheme validation | Client policy checks payee, token, amount, chain, resource, expiry, and settlement horizon before creation | TAP may identify the acting agent but does not replace payment policy |
| Payment was never committed | Depends on scheme and distinction between verification and settlement | Server requires an authenticated creation receipt and usable dPayment state | TAP does not prove payment commitment |
| Terms change between challenge and retry | Payload echoes accepted requirements; exact behavior is implementation and scheme specific | Proof reconstructs window settlement from the preserved immutable reference | TAP signatures only protect fields included in the TAP artifact |
| Duplicate settlement | Common authorization schemes use nonce or chain-specific replay protection | The proof identifies one already-created payment | TAP request nonces do not replace payment-level replay protection |
| Duplicate resource access | Requires application entitlement or consumption state | Requires application entitlement or consumption state | Agent identity can be included in the consumption policy |
| Provider or verifier outage | Facilitator or local verifier availability policy | Explicit `503` or `504`; same proof may be retried | TAP key-store availability is an additional identity-layer dependency |
| Agent impersonation | Depends on payment signer and any application identity layer | Payer is authenticated from the payment creation event; agent identity remains application-defined | TAP adds recognized-agent key verification and identity artifacts |
| Merchant fails to fulfill | Outside the core protocol; recovery depends on scheme and application | Outside automatic fulfillment, but the open dPayment supports refund and dispute workflows | TAP provides attribution, not fulfillment enforcement |

## What d402 still does not solve

d402 does not determine:

- whether an agent's purchase decision was wise;
- whether the human user intended the purchase;
- whether a TAP-recognized agent should be trusted for every action;
- whether a merchant's response was useful or correct;
- whether one payment should grant one use, many uses, or a subscription;
- how fulfillment records are stored atomically;
- which legal agreement or dispute process applies outside the on-chain
  lifecycle.

The practical d402 pattern is:

1. Authenticate the caller when identity matters, optionally with TAP or
   another credential system.
2. Apply client-side payment policy before creating a payment.
3. Bind a request-specific agreement and resource into the payment terms.
4. Verify public on-chain payment evidence before running protected code.
5. Atomically record fulfillment or consumption when the product requires it.
6. Keep the payment open, settle it, refund it, or enter dispute handling
   according to the business outcome.

## Conclusion

The direct protocol comparison is x402 versus d402:

```text
x402 is a general payment-scheme and facilitator framework.
d402 is an opinionated payment-agreement and on-chain lifecycle protocol.
```

Visa TAP operates above or beside that choice. It can be layered on top of
d402 or x402 to authenticate agents and delegation artifacts. With d402, a TAP
authorization can additionally be bound into the request-specific agreement,
allowing the application to require both a recognized agent and a verified
payment for the exact resource terms.
