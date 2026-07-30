# Advanced d402 Server Patterns

d402 verifies HTTP payment proofs and gives the app a verified payment context.
Your app owns access policy, scheduling, retries, and any chain reads beyond
proof verification. Application storage is optional when an endpoint only
needs d402's on-chain one-shot authorization.

That boundary is intentional. d402 proves that a payment matching the request
was created and is currently usable. Your app still decides what entitlement
that payment unlocks, whether it is one-shot or reusable, how fulfillment is
stored, and what recovery path to use if fulfillment later fails.

## Resource Binding

The payment resource defaults to the incoming request URL. Set `terms.resource`
when the payment is for another stable URL or resource identifier.

Use a string when the same payment terms protect one stable URL.

```ts
const route = payable({
  paymentConfig: {
    provider,
  },
  terms: {
    ...terms,
    resource: "https://api.example.com/reports/monthly",
  },
  handler,
});
```

Configure an explicit resource when the payment represents something other
than the literal request URL.

```ts
const route = payable({
  paymentConfig: {
    provider,
  },
  terms: {
    chainId: 100,
    payeeAddress,
    tokenAddress: null,
    netAmount: "10000",
    settlementTimeUnixSec: "4102444800",
    agreement: { id: "report-access:v1:request-123" },
    expiresAtUnixSec: 4102444800,
    resource: "report:monthly:123",
  },
  handler,
});
```

The client defaults to matching the URL it retries. When the server uses a
custom identifier, pass the same string or resolver as the client's `resource`
option. Use a stable public URL pattern or opaque application identifier and
constrain it with client policy. If each request needs a distinct payment
identity, use `paymentConfig.identifier: "client"` or put a stable request or
order ID in `agreement.id`.

### Framework request metadata and request bodies

Use resolver context when a framework extends the standard `Request` type:

```ts
import type { NextRequest } from "next/server";

const route = payable<NextRequest>({
  paymentConfig: { provider },
  terms: async (
    _request,
    { originalRequest, bodyRequest },
  ) => {
    const body = await bodyRequest.json() as {
      reportId: string;
    };

    return {
      ...terms,
      resource:
        `report:${originalRequest.nextUrl.pathname}:${body.reportId}`,
    };
  },
  handler: async (request) => {
    const body = await request.json();
    return Response.json({
      path: request.nextUrl.pathname,
      body,
    });
  },
});
```

The first resolver argument and `bodyRequest` are the same dedicated clone.
Each resolver receives a fresh clone. Use `originalRequest` for framework
metadata and the clone for body reads so the handler retains its body.

## Datastore-Free One-Shot Consumption

Use `Once` when one payment should authorize at most one operation. Construct
the server payment actions once and inject them into the consumer:

```ts
import { Once, payable, paymentActions } from "d402/server";

const actions = paymentActions({ provider, signer: payee });

const route = payable({
  paymentConfig: {
    provider,
    signer: payee,
    identifier: "client",
  },
  consumer: Once(actions),
  terms,
  handler: async () =>
    Response.json(await fulfillOnce()),
});
```

`payable()` verifies the proof and then consumes the payment on-chain before
calling the handler. Only the payee can perform that transition. If two server
instances receive the same proof concurrently, only one consumption
transaction can succeed and only that instance reaches the handler.

The other request is rejected with `422 payment-already-consumed`. The replay
lock therefore works across processes, containers, regions, restarts, and
deployments without:

- A consumed-payment database table;
- Redis or another distributed lock;
- Sticky sessions;
- A shared in-memory cache;
- Coordination between server replicas.

This is a major distinction between payment identity and payment use.
Verification proves that a payment exists for the declared terms. Consumption
atomically claims that payment for fulfillment.

`Once` works with both identity modes. Client identity is normally appropriate
for anonymous pay-per-use endpoints because every purchase receives a fresh
payment identity. Server identity is appropriate when the payment belongs to a
stable invoice, order, or other agreement. After a server-identified payment is
consumed, the same payer needs different hashed terms, such as a new
`agreement.id`, to make a genuinely new purchase.

### What `Once` does not provide

An on-chain claim does not guarantee exactly-once handler completion. If the
process crashes after consumption succeeds but before delivery completes, the
payment remains consumed. Use durable application storage when the product
needs operation recovery, result retrieval, accounting, or an audit trail.

That storage is no longer the protocol replay lock. It records the business
outcome associated with the verified payment:

```ts
handler: async (_request, context) => {
  const result = await operations.createOrRecover({
    paymentId: context.payment.paymentId,
    paymentAddress: context.payment.paymentAddress,
    payerAddress: context.payment.payerAddress,
  });

  return Response.json(result);
}
```

`payerAddress` is not supplied by the proof. The verifier authenticates it from
the trusted factory event and exposes it through `context.payment`.

Consumption also does not settle the payment, reduce refund rights, restrict
disputes, or bypass the arbiter. It records only that the payee claimed the
payment for fulfillment.

## Database-Backed Consumption

`Once` is the canonical choice when the chain should be the shared source of
truth. A database-backed `PaymentConsumer` is also valid when the application
wants to own the replay policy.

```ts
import type { PaymentConsumer } from "d402/server";

function DatabaseOnce(chainId: number): PaymentConsumer {
  return {
    async consume(payment) {
      const inserted = await db.consumedPayments.insertIfAbsent({
        chainId,
        paymentId: payment.paymentId,
        paymentAddress: payment.paymentAddress,
        txHash: payment.txHash,
      });

      return inserted
        ? { ok: true, payment }
        : {
            ok: false,
            reason: "payment-already-consumed",
          };
    },
  };
}

const route = payable({
  paymentConfig,
  consumer: DatabaseOnce(chainId),
  terms,
  handler,
});
```

`insertIfAbsent` must be one atomic operation backed by a unique constraint.
A read followed by a separate insert is unsafe because two replicas can both
observe the payment as unused.

The two approaches make different operational tradeoffs:

| Consumer | Shared authority | Advantages | Costs |
| --- | --- | --- | --- |
| `Once` | The dPayment contract | No application datastore; coordinates every replica through chain state; survives application database loss | Requires a payee transaction, gas, and confirmation latency |
| Database consumer | The integrator's database | No consumption transaction; can create an operation or outbox record atomically with the claim | Every replica must share a strongly consistent database; other deployments cannot observe the claim |
| No consumer / `None` | None | Reusable access with no claim latency | The same proof may authorize repeated requests |

A database consumer is useful when:

- The product already requires a durable job or fulfillment record;
- The claim and an application outbox record should be committed together;
- Consumption latency or transaction cost is unacceptable;
- The application needs a policy richer than a boolean, such as a quota.

Canonical `Once` is useful when:

- A payment must be globally consumed without shared application
  infrastructure;
- Multiple services or regions should agree from chain state alone;
- The replay lock must survive loss or replacement of the application
  datastore.

Choose one authoritative replay lock deliberately. If the route uses `Once`
and also stores an application record, treat the database as recovery and
business state. There is no atomic transaction spanning the blockchain and the
database, so the application must be able to reconcile a successful on-chain
claim with a missing or incomplete application record.

## Reusable Access

Omit `consumer` when reuse is the product behavior. Routes are reusable by
default; `consumer: None` may state that policy explicitly.

Good fits:

- Subscription access
- Session access
- Account credits
- Pay once, access many times

d402 should verify the payment. Your app should decide whether reuse is allowed.
That decision can depend on any application rule you want: account ownership,
SKU, order state, agreement metadata, quotas, or server-side entitlements.

## Limited Reuse

Store a usage count when one payment buys a fixed number of uses.

```ts
const usageKey = [
  context.paymentRequest.chainId,
  context.payment.paymentId,
  context.payment.paymentAddress,
  context.payment.txHash,
].join(":");

const usage = await db.paymentUsage.incrementIfBelowLimit(usageKey, 100);
if (!usage.allowed) {
  return Response.json({ error: "payment-quota-exhausted" }, { status: 409 });
}
```

The limit can come from your terms, account plan, database record, or decoded
business metadata.

## Settlement Timing

Settlement timing is Unix seconds. If the app needs a settlement job, it can
calculate that directly.

```ts
const nowUnixSec = BigInt(Math.floor(Date.now() / 1000));
const settlementUnixSec = BigInt(paymentRequest.settlementTimeUnixSec);

const settlementDue = nowUnixSec >= settlementUnixSec;
const waitSeconds =
  settlementDue ? 0n : settlementUnixSec - nowUnixSec;
```

For a background job, store verified payments and query for records where
`settlementTimeUnixSec <= now`.

```ts
await db.payments.upsert({
  paymentId: context.payment.paymentId,
  paymentAddress: context.payment.paymentAddress,
  txHash: context.payment.txHash,
  settlementTimeUnixSec: context.paymentRequest.settlementTimeUnixSec,
});
```

## Reading On-Chain Payment State

d402 verifies the proof path. Use the dPayment SDK directly when you need full
on-chain payment state.

```ts
import { PaymentReader } from "@rakelabs/dpayments-sdk";

const reader = new PaymentReader(provider);
const paymentInfo = await reader.readPayment(paymentAddress);
```

The bound payment handle works too.

```ts
import { DPayments } from "@rakelabs/dpayments-sdk";

const dpayments = await DPayments.fromProvider(provider, walletAddress);
const paymentInfo = await dpayments.dPayment(paymentAddress).read();
```

Use these reads for detailed payment state, dispute state, evidence, appeals,
and lower-level contract workflows.

## Settlement And Refund Actions

If the app needs lower-level lifecycle actions outside d402's proof
verification path, call the dPayment SDK directly from the server side.

```ts
import { DPayments } from "@rakelabs/dpayments-sdk";

const walletAddress = await signer.getAddress();
const dpayments = await DPayments.fromProvider(provider, walletAddress);
const payment = dpayments.dPayment(paymentAddress);
```

Settle after the settlement time has passed.

```ts
const tx = payment.settle(walletAddress);
const response = await signer.sendTransaction({
  to: tx.to,
  data: tx.data,
  value: BigInt(tx.value),
  chainId: tx.chainId,
});
await response.wait();
```

Refund before settlement if the server cannot fulfill the paid request.

```ts
const tx = payment.voluntaryRefund(walletAddress);
const response = await signer.sendTransaction({
  to: tx.to,
  data: tx.data,
  value: BigInt(tx.value),
  chainId: tx.chainId,
});
await response.wait();
```

The d402 server action helper also exposes common server-side lifecycle actions
for consumers, workers, and recovery flows:

```ts
const actions = paymentActions({ provider, signer });

await actions.settlePayment(paymentAddress);
await actions.refundPayment(paymentAddress);
await actions.consumePayment(paymentAddress);
await actions.submitEvidence(paymentAddress, "ipfs://QmEvidence");
await actions.appealPayment(paymentAddress);
```

Pass the same object to `Once(actions)` when a payable route needs canonical
on-chain one-shot consumption.

## Nonce ownership and concurrent broadcasts

d402 leaves nonce selection entirely to the signer supplied by the
integrator. It does not wrap signers in ethers `NonceManager`, assign explicit
nonces, or retain nonce state.

Client executors and server action helpers privately order broadcasts made
through the same object. This is only local race prevention; it is not a
distributed nonce manager. Independent processes, helpers, and distributed
signers remain responsible for their own coordination.

If a broadcast fails with `NONCE_EXPIRED`, d402 estimates the transaction
again against current contract state and makes up to three more attempts.
Those attempts use bounded exponential backoff with jitter so independent
executors do not remain synchronized. No other error is retried
automatically. If another executor already completed the same payment action,
the fresh estimate can surface the resulting decoded dPayments state error
without broadcasting an unnecessary transaction. d402 does not treat that
case as success because it does not possess the other executor's verified
transaction hash.

## Structured lifecycle logging

d402 does not log by default. Supply a `logger` record sink when a client or
server worker needs payment lifecycle visibility:

```ts
import type { D402Logger } from "d402/server";

const logger: D402Logger = (record) => {
  applicationLogger[record.level](record.context, record.message);
};

const actions = paymentActions({ provider, signer, logger });
```

The same option is accepted by `createD402Client()` and
`createDPaymentsExecutor()`. d402 isolates logging from payment behavior:
thrown logger errors and rejected logger promises are ignored. Records include
stable event names and shallow safe context, never signed transaction payloads,
credentials, evidence URIs, or arbitrary error properties.
