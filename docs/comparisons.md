# Why d402 Instead of x402

d402 and x402 both use HTTP payment challenges, but they make different
security and product choices. x402 is a broad framework for many payment
schemes and facilitator services. d402 is an opinionated protocol for binding a
payment to a specific purchase and keeping that payment usable as a durable
business agreement.

That narrower scope is d402's advantage. It gives clients and servers one
consistent payment model instead of inheriting different guarantees from each
scheme, facilitator, network, and SDK combination.

Visa Trusted Agent Protocol (TAP) is not a competing payment protocol. It is an
agent identity and delegation layer that can be used with either d402 or x402.

## The short answer

d402 is the better choice when payment must be safely connected to one exact
request, when fulfillment may fail or be disputed, or when the server should
verify payment without trusting a payment facilitator.

x402 is the better choice when broad ecosystem compatibility, many chains,
many payment methods, and delegated settlement are more important than having
one uniform agreement and recovery model.

| Concern | x402 | d402 |
| --- | --- | --- |
| Primary abstraction | Pluggable payment payload interpreted by a scheme and verifier | A payment agreement for a specific purchase |
| Security model | Varies by scheme, network, facilitator, SDK, and deployment | One consistent model across d402 routes |
| Purchase binding | Depends on the selected flow and correct implementation | Exact request and agreement binding is a core guarantee |
| Payment timing | Common flows separate authorization, verification, and later settlement | Payment commitment is established before protected fulfillment |
| Verification authority | Local verifier or facilitator | Independently checkable payment state |
| Failure recovery | Scheme- and application-specific | Open payment lifecycle with settlement, refund, and dispute paths |
| Server scaling | May depend on facilitator and scheme state | Outstanding payments survive restarts and can be verified by any replica |
| Ecosystem breadth | Broad | Deliberately focused |

## Why the distinction matters

Payment-gated HTTP is not only a transaction-submission problem. A safe system
must preserve several relationships at once:

- the payment belongs to the intended resource;
- the amount and recipient are the ones the client approved;
- one authorization cannot be transplanted into another purchase context;
- asynchronous settlement cannot create a gap where service is delivered more
  times than payment is collected;
- retryable infrastructure failures do not invite a second payment;
- failed fulfillment has a defined recovery path;
- server restarts and load balancing do not change the purchase being
  verified.

x402 exposes enough flexibility that these properties can vary by
implementation. d402 makes them part of one protocol contract.

## Architectural weaknesses reported in x402 research

Several independent 2026 studies identify security problems at the boundary
between x402's HTTP workflow, signed payment material, facilitator behavior,
and asynchronous blockchain settlement.

These findings do not imply that every x402 deployment is exploitable. Some
are scheme-specific or implementation-specific, and x402 can be hardened with
additional controls. They do show that important safety properties are not
uniformly guaranteed by the base architecture.

### 1. Payment context can be too weakly bound

Researchers demonstrated cross-resource substitution and other context-binding
failures in which valid payment material could be accepted in a purchase
context other than the one the payer intended. The broader lesson is that a
valid signature is not sufficient unless the signed authorization is bound to
the complete purchase context and every verifier enforces that binding.

The systematic study *Free-Riding the Agentic Web* reports cross-resource
substitution among four x402 flaw classes and argues for request-bound
authorization as an architectural mitigation. *Five Attacks on x402 Agentic
Payment Protocol* separately reports practical weaknesses in authorization and
binding across SDKs and live endpoints.

d402 is designed around a payment identity that belongs to the exact purchase
agreement. A valid payment for one purchase is not treated as a generic bearer
authorization for another.

### 2. Verification and settlement can drift apart

Common x402 flows verify an authorization before settlement is final. That
separation creates a time-of-check/time-of-use boundary: the server may decide
to perform work while the payment is still subject to later settlement,
concurrency, or failure.

The NDSS 2026 poster *Exploiting the Two-Phase Gap* reports deployments that
accepted concurrent replays of one payment proof and returned multiple
protected responses while only one settlement completed on-chain.
*Free-Riding the Agentic Web* likewise identifies a duplicate-settlement race
and reports resource leakage in tested SDKs and deployments.

d402 removes that architectural gap from its normal access decision. The
server grants protected access based on an already-established payment rather
than treating an unsettled authorization as equivalent to payment.

### 3. Replay protection does not equal purchase idempotency

A chain nonce can prevent one authorization from being settled twice. It does
not automatically prevent concurrent HTTP requests from receiving duplicate
service before settlement resolves, and it does not define whether one payment
buys one use, a quota, or reusable access.

x402 deployments therefore need additional synchronization and consumption
controls around the verify/settle boundary. Research has reported practical
duplicate-service and duplicate-settlement races when these controls are
missing or incomplete.

d402 makes the payment itself a stable business identity. Applications can
atomically attach one-shot consumption, quotas, or reusable entitlements to
that identity without confusing a payment authorization with a completed
purchase. Application consumption state is still required when the product is
one-shot; d402 makes the correct object available for that decision.

### 4. Dynamic charging expands the trust boundary

x402's flexibility supports variable and usage-based payment schemes. That is
useful, but it introduces pricing and allowance risks when the final cost is
known only after work begins.

*Free-Riding the Agentic Web* reports allowance-overdraft behavior and a
structural problem for output-only pricing when hidden computation can vary.
The result is a wider trust boundary among client authorization, server
measurement, facilitator enforcement, and the service's internal accounting.

d402 is stronger when the purchase should be agreed before payment and
fulfillment. The payer can evaluate the complete price and counterparty policy
before committing funds, and the server verifies that same purchase agreement
before delivering the resource.

### 5. Payment failure and HTTP failure can be ambiguous

The x402 v2 HTTP transport permits payment verification or settlement failure
to return another `402`. Automated clients must inspect the payment response
carefully to determine whether the server is offering payable terms, reporting
an invalid authorization, or reporting a settlement failure.

That ambiguity creates duplicate-payment risk when a client interprets every
`402` as "pay again."

d402 uses `402` only to offer payment when no proof was supplied. Once a
payment is presented, failures are non-payable and distinguish permanent
rejection, pending payment, provider unavailability, and timeout. Temporary
failures can be retried with the same payment instead of creating another one.

### 6. Facilitators expand operational and privacy exposure

x402 permits local verification, but its adoption model commonly places a
facilitator between the resource server and the blockchain. This simplifies
integration while adding another availability, policy, metadata, and trust
boundary.

The paper *Hardening x402: PII-Safe Agentic Payments via Pre-Execution Metadata
Filtering* describes payment metadata—including resource URLs and human-readable
descriptions—being sent to resource servers and centralized facilitator APIs,
and proposes client-side filtering, spending policy, replay guards, and audit
controls.

d402 does not require a payment facilitator to assert that a payment is valid.
The server can independently check the payment evidence it relies on. RPC and
chain infrastructure still exist, but the payment decision is not delegated to
an additional payment-policy service.

### 7. Payment and service delivery are not atomic

x402 does not make successful payment and correct service delivery one atomic
operation. The A402 research project identifies this as a core limitation and
proposes a different atomic service-channel architecture to bind payment
finalization to service execution and result delivery.

d402 does not claim magical atomic fulfillment either. Its advantage is a
recovery-oriented payment lifecycle: a payment can remain open while the
application records fulfillment and can later follow settlement, refund, or
dispute policy. This does not prove service quality, but it gives the
application a durable mechanism for handling failure instead of assuming that
an irreversible transfer and an HTTP response are the same event.

## Why d402 is better for payment-gated resources

### One payment means one defined purchase

d402 treats price, counterparty, resource, expiry, and business agreement as a
single purchase identity. The server does not merely ask whether some payment
payload is valid; it asks whether the payment belongs to the purchase currently
being fulfilled.

This is the right default for autonomous agents because an agent can produce a
cryptographically valid signature while still purchasing the wrong resource,
paying the wrong party, or acting outside its budget. d402 combines exact
purchase binding with payer-side policy so validity and permission are separate
checks.

### Payment exists before expensive work begins

d402 is well suited to resources whose fulfillment is valuable or expensive:

- AI inference;
- reports and data exports;
- file generation;
- private API operations;
- transactions that trigger downstream work;
- paid actions with material business consequences.

The server can require established payment commitment before running protected
code. This avoids relying on an authorization that may later lose a race or
fail during settlement.

### Payment remains useful after the HTTP response

A d402 payment is a durable agreement, not merely a transfer instruction. The
application can associate it with fulfillment records and later settle,
refund, dispute, or resolve it according to the business outcome.

That is materially stronger for commerce where delivery can fail, quality can
be contested, or the merchant should not immediately finalize payment merely
because a handler returned successfully.

### Verification does not depend on remembered challenges

An outstanding d402 payment remains verifiable across cache eviction, process
restart, load balancing, and server replication. Shared challenge storage and
sticky sessions are not correctness requirements.

This improves both resilience and performance: operational caches can be used
aggressively without making payment validity depend on whether a particular
server still remembers an earlier HTTP exchange.

### Failure semantics are safe for automated clients

d402 distinguishes:

- an invitation to pay;
- a permanently rejected payment;
- a payment that is still becoming usable;
- a temporarily unavailable verifier;
- a verifier timeout.

This lets an agent decide whether to stop or retry the same payment. It does
not have to infer from a generic payment challenge whether it is expected to
spend again.

### A smaller protocol has a smaller semantic attack surface

x402's breadth is valuable, but every additional scheme, network adapter,
facilitator, extension, and settlement path creates another combination whose
security properties must be understood.

d402 intentionally standardizes fewer choices. That makes its guarantees more
predictable and its integrations easier to audit. The application can reason
about one payment lifecycle rather than asking which subset of guarantees a
particular x402 stack happens to provide.

## When d402 is decisively the better choice

Choose d402 when any of the following are requirements:

- payment must be bound to one exact request or agreement;
- the server must verify payment independently rather than trust a facilitator;
- protected work is expensive enough that verify/settle races are unacceptable;
- fulfillment can fail and refund or dispute handling matters;
- payments must survive server restarts and move freely across replicas;
- automated clients need unambiguous retry-versus-repay behavior;
- payer policy must constrain resource, amount, recipient, asset, network,
  timing, and agreement before spending;
- the business needs a durable payment identity for accounting, entitlement,
  fulfillment, or evidence;
- consistent guarantees matter more than supporting many payment schemes.

These are common requirements for serious agent commerce. Under those
conditions, d402 is not merely another x402 implementation. It is a safer
payment architecture for the resource server and payer.

## Where x402 remains stronger

x402 has real advantages when the priority is ecosystem breadth:

- many chains and assets;
- pluggable payment schemes;
- standardized facilitator services;
- relayed transactions and gas abstraction;
- usage-based and batch-settlement models;
- broad framework and transport support;
- inexpensive, low-risk, immediately consumed micropayments.

An application may rationally choose those benefits and add the missing
binding, locking, policy, privacy, and recovery controls itself. The important
point is that those controls should not be assumed merely because a request is
x402-compatible.

## Visa TAP can be layered on top

Visa TAP answers a different question: whether an agent and its associated
identity or delegation artifacts are recognized under a trust framework.

d402 answers whether the exact purchase was paid and remains usable. An
application can require both:

```text
recognized and authorized agent
  + verified d402 purchase
  + application entitlement policy
  = protected fulfillment
```

TAP can therefore be placed in front of d402 without becoming part of d402's
payment mechanism. The application may bind the verified agent authorization
to its purchase record when that relationship matters.

The same layering is possible with x402. TAP does not repair payment binding,
settlement races, or fulfillment recovery by itself; it adds identity and
delegation evidence to whichever payment protocol the application selects.

## Research and primary sources

- [Five Attacks on x402 Agentic Payment Protocol](https://arxiv.org/abs/2605.11781)
- [Free-Riding the Agentic Web: A Systematic Security Analysis of x402 Payments](https://arxiv.org/abs/2605.30998)
- [Exploiting the Two-Phase Gap in the x402 Protocol for Autonomous AI Payments](https://www.ndss-symposium.org/wp-content/uploads/ndss26-poster-51.pdf)
- [A402: Binding Cryptocurrency Payments to Service Execution for Agentic Commerce](https://arxiv.org/abs/2603.01179)
- [Hardening x402: PII-Safe Agentic Payments via Pre-Execution Metadata Filtering](https://arxiv.org/abs/2604.11430)
- [x402 protocol repository](https://github.com/x402-foundation/x402)
- [x402 v2 HTTP transport](https://github.com/x402-foundation/x402/blob/main/specs/transports-v2/http.md)
- [Visa Trusted Agent Protocol](https://developer.visa.com/capabilities/trusted-agent-protocol/trusted-agent-protocol-specifications/)

## Conclusion

x402 optimizes for payment-scheme interoperability. d402 optimizes for safe,
request-bound commerce.

For low-risk micropayments, broad chain support, or facilitator-led settlement,
x402 may be the more convenient ecosystem. For exact purchases, expensive
fulfillment, autonomous-agent policy, independent verification, failure
recovery, and durable payment agreements, d402 provides the stronger model.

That is the reason to choose d402: fewer architectural assumptions, tighter
purchase semantics, safer automated retries, and a payment lifecycle designed
for the business outcome rather than only the transfer.
