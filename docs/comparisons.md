# d402 Compared With x402 and Visa Trusted Agent Protocol

This document explains where d402 is a better fit than x402 or Visa's Trusted
Agent Protocol (TAP), and where those systems solve different problems. The
claim is not that d402 replaces identity, card-network authorization, or
general-purpose payment interoperability. The narrower claim is that d402
provides a stronger, more explicit control boundary for an HTTP resource whose
access decision depends on a particular payment agreement and on-chain payment
state.

The comparison is based on the public x402 documentation and repository and
Visa's public TAP specification as available on July 18, 2026:

- [x402 introduction](https://docs.x402.org/introduction)
- [x402 client/server flow](https://docs.x402.org/core-concepts/client-server)
- [x402 facilitator model](https://docs.x402.org/core-concepts/facilitator)
- [x402 protocol repository](https://github.com/x402-foundation/x402)
- [Visa TAP specifications](https://developer.visa.com/capabilities/trusted-agent-protocol/trusted-agent-protocol-specifications/)
- [Visa TAP getting started guide](https://developer.visa.com/capabilities/trusted-agent-protocol/docs)

## Executive summary

The three systems answer different questions:

| System | Primary question answered |
| --- | --- |
| Visa TAP | “Is this request from an agent recognized by the scheme, and can the merchant verify the linked consumer/payment artifacts?” |
| x402 | “Has the client supplied a payment payload that the selected scheme and verifier/facilitator accept?” |
| d402 | “Was a payment matching these exact resource terms created, by this payer, for this payee, on this chain, and is its on-chain state currently usable?” |

For resource authorization, the d402 question is the most directly useful one.
It binds payment to an HTTP resource and method, hashes the terms, carries the
payment identity in a proof, and verifies the creation event and live payment
state before invoking the protected handler. See [the d402 protocol
description](protocol.md).

## The central design distinction: identity is not behavior

A signature proves possession of a private key and integrity of the signed
message. It does not prove that the signer chose the right product, price,
recipient, scope, or business action. Nor does it prove that the service
provider fulfilled its side of the agreement.

This is the limitation of treating “trusted agent” as if it were a complete
authorization model. A registry, certification program, public key, or signed
agent header can make attribution and message filtering better. It cannot make
an autonomous agent infallible, and it cannot turn an issuer's assertion of
trust into evidence that a specific purchase was appropriate.

Visa TAP is explicit that merchants retrieve agent keys from a trusted key
store and verify an agent recognition signature. It also defines signed
consumer/device identity and payment-container artifacts. Those are useful
recognition and integrity controls. They remain an external trust and
governance dependency, however: the merchant must trust the key issuer,
onboarding process, revocation process, and the agent's operational behavior.
The TAP signature does not itself encode a cryptographically enforced
“the agent was allowed to buy this exact resource for this exact amount” rule,
nor does it settle or escrow the merchant's fulfillment obligation. See the
[TAP trust model](https://developer.visa.com/capabilities/trusted-agent-protocol/trusted-agent-protocol-specifications/).

d402 treats that missing distinction as a boundary condition rather than
calling it trust. The client has an explicit local spending policy, and the
server verifies the payment agreement and on-chain state independently of any
agent reputation. A compromised or over-eager agent may still sign an unwanted
payment, but it cannot make that payment satisfy a d402 policy that rejects the
chain, payee, token, amount, resource, expiry, settlement window, or agreement
requirements.

## d402 versus Visa TAP

### Where d402 is stronger

#### 1. Explicit resource and terms binding

d402 includes a canonical resource, optional HTTP method, chain, payee, token,
amount, settlement time, expiry, agreement metadata, and a deterministic
`termsHash`/`paymentId`. The client checks the request binding before spending;
the server checks it again before access is granted.

TAP message signatures protect selected request data from modification and
help identify the agent. They are not a substitute for an application-specific
payment agreement. A merchant still needs separate policy to decide whether
the requested item, price, quantity, and fulfillment terms are acceptable.

#### 2. Evidence of payment state, not only evidence of signer identity

d402 verifies the transaction receipt, expected `PaymentCreated` event, factory,
payment address, payer, payee, token, amount, settlement time, confirmations,
and current payment state. The protected handler is called only after those
checks succeed.

TAP's agent recognition signature answers who sent the message and whether it
was altered. It does not by itself prove that funds were irrevocably committed
to the merchant or that an escrow/payment state is still usable.

#### 3. An on-chain recovery and dispute boundary

d402 payments can remain open and later be settled, refunded, disputed, or
resolved. Evidence can be published separately and its URI submitted on-chain.
That gives the application a durable payment identity and lifecycle to attach
to fulfillment, recovery, and dispute processing.

TAP is primarily a recognition, identity, and payment-network interaction
protocol. It does not define d402's open-payment lifecycle or provide the same
application-facing on-chain state model.

### Where TAP is stronger or broader

TAP is better suited when a merchant needs payment-network onboarding, consumer
recognition, card-network controls, or compatibility with existing Visa
credentials and checkout infrastructure. It can help a merchant distinguish
recognized agents from unknown automation before the merchant chooses whether
to expose more information or begin checkout.

d402 does not currently provide a Visa-style agent registry, consumer ID token,
card credential container, or network-wide agent onboarding program. Neither
does the x402 payment protocol inherently provide those things. They are
separate identity, governance, and policy layers rather than properties that
follow from using HTTP 402 or signing a payment payload.

### A trusted-agent registry can be built on top of d402

A registry or attestation service can be layered on top of d402 without
changing the payment protocol. For example, an application could require a
client to present an agent credential, verify that credential against an
allowlist or public key directory, and then apply the resulting agent policy
before accepting the d402 payment proof. The server could also bind the agent
identity or authorization scope into `agreement.id` or into application-owned
metadata recorded alongside the verified payment.

That architecture is more honest about the division of responsibility:

- the registry answers “who is this agent and what policy is associated with
  it?”
- d402 answers “what exact resource/payment agreement was funded, by whom, and
  is the payment currently usable?”
- the application answers “does this verified payment and agent authorization
  entitle this request to fulfillment?”

The registry remains useful, but it is not asked to prove that the agent will
behave correctly. A valid registry credential can authorize an agent to
attempt a class of actions; d402 still constrains the concrete payment and
resource transaction. The same layering is possible with x402, whose core
protocol also does not require a universal trusted-agent registry.

## d402 versus x402

### Shared foundation

Both protocols use HTTP 402 to return payment requirements, then have the
client retry with cryptographic payment material. Both can support automated
clients and agents, and both can use on-chain payments. x402's standard flow
allows the server to verify locally or call a facilitator's `/verify` and
`/settle` endpoints. See the [x402 client/server flow](https://docs.x402.org/core-concepts/client-server)
and [facilitator documentation](https://docs.x402.org/core-concepts/facilitator).

### Where d402 is stronger for its target use case

#### 1. Payment is an agreement object, not just a payment payload

x402 intentionally supports multiple schemes and networks. The payment
payload is interpreted by the selected `(scheme, network)` implementation. That
is valuable for interoperability, but it means the semantics and guarantees
depend on the scheme and verifier in use.

d402 defines a narrower EVM payment model around a dPayment object. Its terms
hash is the payment ID, and its proof identifies the payment address and
creation transaction. This makes the resource/payment relationship explicit
and gives the server a stable object to inspect over time.

#### 2. Verification before handler execution is the primary contract

d402's `payable` wrapper verifies the proof and live payment state before it
invokes the protected handler. A custom verifier can add one-shot consumption,
account binding, quotas, or other application policy.

x402 also lets a resource server verify before fulfillment, but the protocol is
deliberately flexible about whether verification and settlement are local or
delegated. A facilitator response is an infrastructure result, not a
cryptographic proof that the merchant fulfilled the resource. The application
still owns fulfillment and idempotency.

#### 3. Payment lifecycle is first-class

d402 models states such as funded, settled, disputed, and resolved, with
settlement windows, refunds, evidence submission, and appeals exposed through
server actions. This is useful when the request is a business agreement rather
than an irreversible “pay and immediately deliver” call.

x402's strengths are fast, composable payment schemes and broad network
support. Its exact, usage-based, and batch-settlement schemes can be a better
fit for high-volume or variable-cost payments. In particular, x402 documents
batch settlement using escrow and signed off-chain vouchers for repeated EVM
micropayments. See [x402 network and token support](https://docs.x402.org/core-concepts/network-and-token-support).

### The important qualification

d402 is not “more decentralized” merely because it uses a blockchain. It still
depends on an RPC provider, the dPayments contracts, EVM chain governance, and
the application operator's signer and storage. Its advantage is narrower and
more concrete: the access decision can be checked against public payment state
and exact terms instead of depending only on an agent's identity or a
facilitator's assertion.

Likewise, x402 does not necessarily require a centralized facilitator. Its
documentation says verification and settlement may be performed locally or by
a facilitator. The architectural comparison is therefore between d402's
opinionated on-chain payment object and x402's more general scheme/facilitator
abstraction, not between “decentralized d402” and “centralized x402.”

## Threat-model comparison

| Threat or failure | Visa TAP | x402 | d402 |
| --- | --- | --- | --- |
| Impersonated agent | Public-key verification and key-store trust | Depends on the scheme's signature verification | Payment proof and on-chain creation-event verification |
| Agent sends a valid but unwanted request | Not prevented by agent identity alone | Client/wallet policy is application-dependent | Client policy can reject resource, amount, payee, chain, token, expiry, and settlement terms before payment |
| Payment payload altered in transit | Message signature detects covered-field changes | Scheme verification detects invalid payload | Terms hash, proof binding, and on-chain checks detect mismatch |
| Payment never actually committed | TAP does not itself establish escrow/payment state | Depends on scheme and whether verification precedes settlement | Server checks transaction receipt and dPayment state before access |
| Resource falsely claims fulfillment | Outside TAP | Outside core x402 | Outside d402 core, but payment remains open for refund/dispute/recovery workflows |
| Replay or duplicate access | Nonce/expiry guidance plus merchant controls | Scheme/facilitator-specific; some flows require duplicate-settlement caches | Proof replay checks plus application-level one-shot consumption with atomic storage |
| Issuer/key-store compromise | Material trust dependency | Optional application identity/registry dependency; not required by core x402 | Optional application identity/registry dependency; not required by d402 payment verification |

## What d402 still does not solve

d402 is not an autonomous-agent safety system. It cannot determine whether an
agent's decision was wise, whether the user really intended the purchase, or
whether the protected service delivered something useful. Those require
application policy, user authorization, quotas, monitoring, and recovery.

The practical d402 pattern is therefore:

1. Use a wallet or agent policy to constrain what may be paid.
2. Bind the payment to a specific resource and agreement.
3. Verify public on-chain payment evidence before running the handler.
4. Record the verified payment identity and fulfillment result.
5. Keep the payment open when fulfillment may fail; settle, refund, dispute, or
   resolve it according to the business outcome.

That is the core reason d402 is better for payment-gated HTTP resources: it
reduces the amount of behavior that must be inferred from an agent's reputation
or an intermediary's “trusted” assertion. It does not eliminate trust; it
pushes the critical access decision toward explicit policy, cryptographic
binding, and independently inspectable payment state.
