# Scaling d402

d402 payable verification is designed to run on stateless, horizontally scaled
HTTP servers. A payment challenge does not create a server session, and an
outstanding payment does not belong to the replica that issued it.

Any correctly configured replica can authenticate the proof and continue the
request. The blockchain is the payment source of truth; application storage is
needed only when the product itself requires business state.

## What Is Stateless

For ordinary payable verification, a replica needs only:

- the same route terms or access to the same terms source;
- the same payment configuration;
- access to the configured chain provider; and
- the payment proof supplied by the client.

The server does not need to persist:

- issued payment challenges;
- payer sessions created by d402;
- pending payment IDs;
- proof-to-replica affinity;
- a shared verification cache; or
- sticky load-balancer sessions.

The creation transaction and canonical factory event authenticate the payment.
For settlement-window payments, the proof carries the issued block reference,
and another replica verifies that reference by block hash. A newer replica does
not silently replace it with its own latest block.

This permits the normal flow to cross replicas:

```text
client -> replica A: request without proof
replica A -> client: 402 challenge
client -> chain: create payment
client -> replica B: retry with proof
replica B -> chain: authenticate and observe payment
replica B -> client: protected response
```

Replica A can restart or disappear after issuing the challenge. Replica B does
not require any memory from it.

## Requirements Across Replicas

Stateless verification still requires replicas to agree on configuration.

### Stable terms

The paid retry must reconstruct the same payment-defining terms that the client
paid. If terms are dynamic, derive them from stable shared business data such
as an order, quote, invoice, or price version. Do not let a deployment, clock
tick, or independent in-memory value silently change the amount, payee, token,
agreement, resource, or settlement terms between the challenge and retry.

Challenge expiration is deliberately not part of payment identity and may be
reissued. Payment-defining terms must remain stable.

Use a stable `agreement.id` for server-identified orders. Use client identity
when identical terms should permit independent purchases.

### Consistent chain access

Replicas may use different RPC nodes, but those providers must represent the
same configured chain. Temporary provider lag can produce retryable `425`,
`503`, or `504` responses. The client can resend the same proof; it does not
need to create another payment.

Confirmation depth, settlement configuration, trusted Multicall settings, and
proof-header configuration should be deployed consistently.

Behind a reverse proxy, configure a stable resource resolver so public payment
identity does not depend on an internal replica hostname.

### Shared application rules

`VerificationPolicy`, terms logic, and handler behavior should be equivalent
across the replica set. A rolling deployment can intentionally support two
compatible versions, but conflicting policy or terms can make authorization
depend on which replica receives the request.

## Caches Are Performance Only

Settlement-reference caches and in-flight read deduplication are local to each
process. They reduce provider traffic but are not correctness state.

A cold replica can verify the same proof directly from the provider. Cache
eviction, process restart, autoscaling, or traffic moving to another region
does not invalidate an outstanding payment.

Do not put application authorization or fulfillment truth only in these local
caches. Use durable application storage when the product requires that state.

## Reusable Routes

Reusable payable routes are the simplest scaling mode. Every replica
authenticates and observes the payment independently, then runs the handler.
No d402 write or shared replay lock is required.

This fits subscriptions, account credits, memberships, and pay-once access
where the same proof may authorize multiple requests. Application quotas and
balances still require their own atomic datastore operations.

## One-Shot Routes Across Replicas

Use `Once(actions)` when one payment should authorize at most one handler
execution. `Once` claims the payment on-chain before entering the handler:

```ts
const actions = paymentActions({ provider, signer: payee });

const route = payable({
  paymentConfig: {
    provider,
    signer: payee,
    identifier: "client",
  },
  consumer: Once(actions),
  terms,
  handler,
});
```

Competing replicas may authenticate the same proof, but only one on-chain
consumption transition can succeed. Only the replica that acquires that claim
enters the handler. The chain replaces Redis, sticky sessions, and a shared
consumed-payment table as the replay authority.

This is an at-most-once authorization guarantee, not exactly-once business
completion. Persist important work and results by `paymentId`, and configure
`PaymentRecovery` when a retry should return an existing result.

## Database-Owned Claims

A database `PaymentConsumer` is appropriate when the application already needs
a durable operation, job, quota, or outbox record. Every replica must use the
same strongly consistent database, and the claim must be one atomic operation
backed by a unique constraint.

The database consumer can atomically claim the payment and create the business
record. This closes a failure window that cannot be closed by a transaction
split between an on-chain `Once` action and an application database write.

Choose one replay authority deliberately:

| Authority | Coordination | Tradeoff |
| --- | --- | --- |
| No consumer | None | Reusable payment; every valid replay may reach the handler |
| `Once` | dPayment contract | Global on-chain claim without shared application storage |
| Database consumer | Shared database | Atomic claim plus application record, but database availability is required |

## Recovery and Business State

Protocol verification is stateless. Fulfillment often is not.

Generated reports, orders, tickets, jobs, account balances, and audit records
belong in durable application storage. `PaymentRecovery` looks up an existing
result after payment authentication and before current-state verification or
consumption.

All replicas must be able to reach the same recovery data when retries may land
on any replica. Object storage plus a shared metadata database is a common
pattern for large artifacts.

Do not use in-memory recovery maps in a horizontally scaled deployment. They
reintroduce replica affinity and lose results during restart.

## Shared Signers Across Replicas

Settlement, refund, consumption, evidence, and appeal actions broadcast from
the configured signer. Each `paymentActions()` or client executor instance
orders its own broadcasts, but d402 does not provide a distributed nonce
manager across processes.

Replicas can nevertheless use the same externally owned account directly.
They do not need separate signers, a shared `NonceManager`, or an external
transaction worker for normal d402 action races. 

That behavior has been verified and tested.

The retry is deliberately not a persistent distributed nonce allocator. Under
sustained, high-volume transaction traffic, bounded retries can be exhausted.
At that scale, or when custody policy requires centralized signing, an
integrator may choose:

- a remote signer or custody service that owns nonce coordination;
- a shared transaction service or worker used by every replica;
- separate funded signers where the contract action permits them; or
- application-owned distributed nonce coordination.

For `refunder()` and synchronous `Once` routes, every serving replica needs a
usable payee signer or access to a remote signer for that payee. Sharing the
same key across replicas is supported. Keeping verification replicas
signer-free and sending lifecycle actions to a transaction worker is an
optional custody or throughput architecture, not a d402 correctness
requirement.

## Provider Capacity

Horizontal HTTP scaling can move the bottleneck to the RPC provider. Plan for:

- receipt reads for payment creation authentication;
- confirmation and block-reference reads;
- live payment-state observation;
- transaction estimation, broadcast, and receipt waits for actions; and
- provider rate limits and regional latency.

Use trusted provider infrastructure, appropriate request timeouts, and
application-level metrics. The optional d402 cache and in-flight deduplication
reduce repeated reads within one process; they do not coordinate provider load
across replicas.

## Deployment Patterns

### Stateless verification tier

Run any number of signer-free payable replicas behind a load balancer. Use
reusable routes or a shared database consumer. This is the lowest-operational-
state deployment.

### On-chain one-shot tier

Run payable replicas with `Once` and the same payee signer configuration. The
built-in fresh-estimation retry handles the tested cross-replica nonce races,
and the chain is the replay authority. Store fulfillment results separately
for recovery. Add centralized signer infrastructure only when transaction
volume or custody policy calls for it.

### Verification plus transaction workers

Keep HTTP replicas focused on proof verification and application policy. Queue
settlement, evidence, and other lifecycle actions to signer-owning workers.
This is useful for centralized custody, rate control, and asynchronous work;
it is not required merely because multiple replicas share a signer. Use
`refunder()` directly when the refund response should wait for the confirmed
transaction.

### Database and outbox

Use a database consumer to claim the payment and create an outbox or job record
in one transaction. Workers fulfill the operation, and every replica serves
status or recovery responses from shared storage.

## Failure Behavior

| Failure | Expected behavior |
| --- | --- |
| Challenge replica stops | Retry with proof against another replica |
| Verification replica restarts | Re-read proof and chain state; no challenge store is needed |
| Local cache is empty | Read the canonical reference from the provider |
| Provider is temporarily behind | Return a retryable response and reuse the same proof |
| Two replicas race on `Once` | One acquires the on-chain claim; the other is rejected |
| Response is lost after work completes | Retry and recover the durable result by `paymentId` |
| Process dies after `Once` but before durable work | Reconcile or use a database claim plus outbox |
| Two replicas broadcast with one EOA | d402 retries `NONCE_EXPIRED` after fresh estimation; contract state prevents a duplicate transition |
| Sustained signer contention exhausts bounded retries | Retry the operation or introduce centralized nonce coordination for that workload |

## Production Checklist

- Keep route terms deterministic across replicas.
- Deploy identical chain, confirmation, settlement, and proof-header settings.
- Treat local caches as disposable optimizations.
- Choose reusable, on-chain `Once`, or database consumption deliberately.
- Persist business results by authenticated payment identity.
- Make handlers and workers idempotent by `paymentId`.
- Use shared recovery storage when traffic can move across replicas.
- Replicas may share one signing account; add centralized nonce coordination
  only when custody policy or sustained transaction volume requires it.
- Monitor provider latency, retryable verification failures, and transaction
  confirmation time.
- Test challenge issuance, paid retry, restart recovery, and one-shot races
  across different replicas.