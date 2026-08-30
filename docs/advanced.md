# Advanced d402 Server Patterns

d402 verifies HTTP payment proofs and gives the app a verified payment context.
Your app owns access policy, scheduling, retries, and any chain reads beyond
proof verification. Application storage is optional when an endpoint only
needs d402's on-chain one-shot authorization.

For CORS, framework middleware, and request credentials, see
[HTTP and Framework Integration](./http-integration.md). For replicated
deployment architecture, see [Scaling d402](./scaling.md).

That boundary is intentional. d402 proves that a payment matching the request
was created and is currently usable. Your app still decides what entitlement
that payment unlocks, whether it is one-shot or reusable, how fulfillment is
stored, and how completed work is recovered if response delivery fails.

## Two Equivalent Integration Forms

Every payable example in this guide can be mounted in either of two forms:

- `payable()` is a Fetch-native route wrapper. It authorizes the request and
  invokes the supplied handler.
- `PaymentAuthorizer` runs the same authorization pipeline but returns either
  a protocol `Response` or an authorized context. It is usually simpler when a
  framework already owns routing, middleware, and response conversion.

The framework form is the operation that `payable()` performs internally:

```ts
import {
  PaymentAuthorizer,
  payable,
  type PayableHandler,
  type PaymentAuthorizationConfig,
} from "d402/server";

function frameworkController<Req extends Request, Result>(
  authorizer: PaymentAuthorizer<Req, Result>,
  handler: PayableHandler<Req, Result>,
): (request: Req) => Promise<Response> {
  return async (request) => {
    const authorization = await authorizer.authorize(request);

    if (authorization.response !== undefined) {
      return authorization.response;
    }

    return handler(request, authorization.context);
  };
}
```

Real framework controllers can decorate or translate either response and can
run session authentication, CORS, tracing, and error middleware around
`authorize()`. The examples below name both resulting handlers:

```ts
// Fetch-native integration
const fetchRoute = payable({ ...authorizationConfig, handler });

// Framework-owned integration
const authorizer = new PaymentAuthorizer(authorizationConfig);
const frameworkRoute = frameworkController(authorizer, handler);
```

Choose one form for a route. They are shown together only to make the two
integration surfaces explicit.

For complete runnable files using identical terms, compare the Express
[`PaymentAuthorizer` server](../examples/express-native/src/payment-authorizer-server.ts)
and [`payable()` server](../examples/express-native/src/payable-server.ts).

## Resource Binding

The payment resource defaults to the incoming request URL. Set `terms.resource`
when the payment is for another stable URL or resource identifier.

Use a string when the same payment terms protect one stable URL.

```ts
const authorizationConfig = {
  adapter,
  payment: {},
  terms: {
    ...terms,
    resource: "https://api.example.com/reports/monthly",
  },
} satisfies PaymentAuthorizationConfig;

const fetchRoute = payable({ ...authorizationConfig, handler });
const authorizer = new PaymentAuthorizer(authorizationConfig);
const frameworkRoute = frameworkController(authorizer, handler);
```

Configure an explicit resource when the payment represents something other
than the literal request URL.

```ts
const authorizationConfig = {
  adapter,
  payment: {},
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
} satisfies PaymentAuthorizationConfig;

const fetchRoute = payable({ ...authorizationConfig, handler });
const authorizer = new PaymentAuthorizer(authorizationConfig);
const frameworkRoute = frameworkController(authorizer, handler);
```

The client defaults to matching the URL it retries. When the server uses a
custom identifier, pass the same string or resolver as the client's `resource`
option. Use a stable public URL pattern or opaque application identifier and
constrain it with client policy. If each request needs a distinct payment
identity, use `payment.identifier: "client"` or put a stable request or
order ID in `agreement.id`.

### Framework request metadata and request bodies

Use resolver context when a framework extends the standard `Request` type:

```ts
import type { NextRequest } from "next/server";

const authorizationConfig = {
  adapter,
  payment: {},
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
} satisfies PaymentAuthorizationConfig<NextRequest>;

const handler: PayableHandler<NextRequest> = async (request) => {
  const body = await request.json();
  return Response.json({
    path: request.nextUrl.pathname,
    body,
  });
};

const fetchRoute = payable({ ...authorizationConfig, handler });
const authorizer = new PaymentAuthorizer(authorizationConfig);
const frameworkRoute = frameworkController(authorizer, handler);
```

The first resolver argument and `bodyRequest` are the same dedicated clone.
Each resolver receives a fresh clone. Use `originalRequest` for framework
metadata and the clone for body reads so the handler retains its body.

## Payable Authorization Pipeline

Both public forms enter the same authorizer:

```text
payable({ adapter, payment, handler })
                   |
                   v
          PaymentAuthorizer.authorize(request)
                   |
          +--------+--------+
          |                 |
   protocol Response   authorized context
          |                 |
        return            handler

framework controller
          |
          v
PaymentAuthorizer.authorize(request)
          |
          +-- protocol Response -> framework decorates/translates -> return
          |
          +-- authorized context -> framework invokes business handler
```

A proof-bearing request passes through these stages:

```text
resolve terms
-> authenticate payment creation
-> recover an existing result
-> observe current on-chain state
-> apply VerificationPolicy
-> apply PaymentConsumer
-> run the handler
```

Each stage owns one question:

| Stage | Question |
| --- | --- |
| Terms | What payment does this request require? |
| Authentication | Does the proof identify a real payment matching those terms? |
| Recovery | Did this authenticated payment already produce a durable result? |
| Observation | What is the payment's current canonical on-chain state? |
| `VerificationPolicy` | May this route accept a payment in that observed state? |
| `PaymentConsumer` | May this payment authorization be used again? |
| Handler | What business operation does an authorized request perform? |

Authentication and observation are canonical d402 mechanics. Integrators
configure terms, recovery, verification, consumption, and handling without
replacing proof authentication.

## Verification Policy

An authentic payment is not automatically acceptable for every route. It may
have been settled, disputed, or resolved.
`VerificationPolicy` exists to decide whether the canonically observed payment
state is acceptable before consumption or business work begins.

The policy receives `ObservedPaymentContext`:

```ts
interface ObservedPaymentContext {
  paymentRequest: D402PaymentRequest;
  dPaymentProof: DPaymentProof;
  payment: ObservedPayment;
  settlementReference?: D402BlockReference;
}
```

The default is `FundedOrSettledPayment`. It accepts payments in `funded` or
`settled` state and rejects disputed or resolved payments. This is appropriate
for ordinary access routes where prior settlement should not erase the thing
the customer purchased.

Use `FundedPayment` when fulfillment must begin only while the payee can still
voluntarily refund the payment. A production example is a physical inventory
reservation: if stock allocation fails, the server still needs the refund path
to be available.

```ts
import { FundedPayment } from "d402/server";

const authorizationConfig = {
  ...paymentConfig,
  terms,
  verificationPolicy: FundedPayment,
} satisfies PaymentAuthorizationConfig;

const handler: PayableHandler = async (_request, context) => {
  const reservation = await inventory.reserve({
    paymentId: context.payment.paymentId,
  });

  return Response.json(reservation);
};

const fetchRoute = payable({ ...authorizationConfig, handler });
const authorizer = new PaymentAuthorizer(authorizationConfig);
const frameworkRoute = frameworkController(authorizer, handler);
```

Most routes should use one of these built-in policies. A custom policy is only
needed for a stricter route-level decision based on the authenticated payment
request or observed payment. Keep it read-only: it should not authenticate the
HTTP caller, claim one-shot use, execute fulfillment, or broadcast payment
actions. Those jobs belong to the surrounding application, consumer, handler,
or refund route.

## Handler

The handler performs new business work after payment authorization succeeds.
It receives the original HTTP request and a `PayableContext` containing the
authenticated payment request, proof, observed payment, and consumer result.

```ts
const authorizationConfig = {
  ...paymentConfig,
  terms,
} satisfies PaymentAuthorizationConfig;

const handler: PayableHandler = async (request, context) => {
  const input = await request.json() as ReportInput;
  const report = await reports.create({
    input,
    paymentId: context.payment.paymentId,
    payerAddress: context.payment.payerAddress,
  });

  await db.results.put({
    paymentId: context.payment.paymentId,
    result: report,
  });

  return Response.json(report);
};

const fetchRoute = payable({ ...authorizationConfig, handler });
const authorizer = new PaymentAuthorizer(authorizationConfig);
const frameworkRoute = frameworkController(authorizer, handler);
```

The handler is the right place to generate content, create an order, reserve
inventory, provision credits, or enqueue a job. It is not the place to parse or
trust payment proof fields directly; d402 has already authenticated them into
`context`.

A consumer controls whether the handler may be entered more than once, but it
cannot guarantee that the handler finishes exactly once. Make important
operations idempotent by `paymentId` and persist their result before returning
the response. The recovery hook can then deliver that result after a retry.

## Datastore-Free One-Shot Consumption

Use `Once` when one payment should authorize at most one operation. Construct
the server payment actions once and inject them into the consumer:

```ts
import { Once, paymentActions } from "d402/server";

const paymentConfig = {
  adapter,
  payment: { identifier: "client" },
};
const actions = paymentActions(paymentConfig);

const authorizationConfig = {
  ...paymentConfig,
  consumer: Once(actions),
  terms,
} satisfies PaymentAuthorizationConfig;

const handler: PayableHandler = async () =>
  Response.json(await fulfillOnce());

const fetchRoute = payable({ ...authorizationConfig, handler });
const authorizer = new PaymentAuthorizer(authorizationConfig);
const frameworkRoute = frameworkController(authorizer, handler);
```

Both integration forms verify the proof and then consume the payment on-chain
before calling the handler. Only the payee can perform that transition. If two
server instances receive the same proof concurrently, only one consumption
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

`payerAddress` is not supplied by the proof. The authenticator derives it from
the trusted factory event and exposes it through `context.payment`.

Consumption also does not settle the payment, reduce refund rights, restrict
disputes, or bypass the arbiter. It records only that the payee claimed the
payment for fulfillment.

## Payment Recovery

The authorization configuration's `recovery` hook returns work that the
application already completed for an authenticated payment. It is not a retry
callback and should not start new work.

The relevant authorization order is:

```text
authenticate payment
-> recovery
-> observe current state
-> verification policy
-> consumer
-> handler
```

If `recovery` returns a `Response`, `payable()` returns it directly and
`PaymentAuthorizer.authorize()` returns it as `authorization.response`.
Observation, verification, consumption, and the handler are skipped. If the
hook returns `undefined`, normal authorization continues.

```ts
import type { PaymentRecovery } from "d402/server";

const recovery: PaymentRecovery = async ({ payment }) => {
  const completed = await db.results.findByPaymentId(payment.paymentId);

  return completed === undefined
    ? undefined
    : Response.json(completed.result);
};

const authorizationConfig = {
  ...paymentConfig,
  terms,
  recovery,
  consumer: Once(actions),
} satisfies PaymentAuthorizationConfig;

const fetchRoute = payable({ ...authorizationConfig, handler });
const authorizer = new PaymentAuthorizer(authorizationConfig);
const frameworkRoute = frameworkController(authorizer, handler);
```

Recovery runs before live-state observation because completed work may still
need to be delivered after its payment has been consumed, settled, disputed,
or resolved. Those states prevent new work; they do not erase a result that was
already produced.

### Lost HTTP response

Consider a production report API:

1. The server consumes the payment.
2. It generates the report and stores it under `paymentId`.
3. The connection closes before the client receives the response.
4. The client retries with the same proof.

Without recovery, `Once` rejects the retry because the payment is already
consumed. With recovery, the retry returns the stored report without generating
or charging for it again.

The handler must store the result before returning it:

```ts
handler: async (_request, { payment }) => {
  const report = await reports.generate();

  await db.results.put({
    paymentId: payment.paymentId,
    result: report,
  });

  return Response.json(report);
},
```

### Asynchronous paid job

For a paid video render, model-training run, or large export, store a durable
job keyed by `paymentId`. Recovery can return the current job status on every
retry and the final result after completion:

```ts
const recoverJob: PaymentRecovery = async ({ payment }) => {
  const job = await db.jobs.findByPaymentId(payment.paymentId);
  if (job === undefined) return undefined;

  return job.status === "complete"
    ? Response.json(job.result)
    : Response.json(
        { jobId: job.id, status: job.status },
        { status: 202 },
      );
};
```

The paid handler creates the job once and returns `202`. A worker updates the
same record. Recovery does not enqueue another job.

### Generated artifact or download

For a generated PDF, data archive, or licensed download, store the object key
against the authenticated payment. Recovery can issue a fresh short-lived
download URL without regenerating the artifact:

```ts
const recoverArtifact: PaymentRecovery = async ({ payment }) => {
  const artifact = await db.artifacts.findByPaymentId(payment.paymentId);
  if (artifact === undefined) return undefined;

  const url = await objectStorage.createSignedUrl(artifact.objectKey);
  return Response.redirect(url, 303);
};
```

### Durable order receipt

For an order, reservation, or ticket purchase, persist the business identifier
with the payment. A retry can return the same receipt instead of creating a
second order:

```ts
const recoverReceipt: PaymentRecovery = async ({ payment }) => {
  const order = await db.orders.findByPaymentId(payment.paymentId);
  if (order === undefined) return undefined;

  return Response.json({
    orderId: order.id,
    status: order.status,
    receiptUrl: order.receiptUrl,
  });
};
```

### What recovery does not solve

There is still no atomic transaction spanning on-chain consumption and an
application database. If the process dies after `Once` consumes the payment
but before a durable result or job record exists, `recovery` has nothing to
return. Production systems that cannot tolerate that gap should use a durable
job/outbox design, reconciliation worker, or a database consumer that creates
the business record atomically with its payment claim.

`PaymentRecovery` receives an `AuthenticatedPaymentContext`, not the current
HTTP request or an `ObservedPaymentContext`. Payment authentication proves the
historical payment; it does not authenticate the current caller. If a recovered
result contains account-private data, authenticate the application request in
the surrounding controller before invoking `payable()` or
`PaymentAuthorizer`.

Keep the hook narrow:

- Return only an existing durable result, job status, artifact, or receipt.
- Key records by authenticated payment identity, normally `paymentId`.
- Return `undefined` when no completed or recoverable record exists.
- Do not create orders, enqueue jobs, grant entitlements, or perform other new
  side effects from recovery.

## Database-Backed Consumption

`Once` is the canonical choice when the chain should be the shared source of
truth. A database-backed `PaymentConsumer` is also valid when the application
wants to own the replay policy.

```ts
import type { PaymentConsumer } from "d402/server";

function DatabaseOnce(chainId: number): PaymentConsumer {
  return {
    async consume({ payment }) {
      const inserted = await db.consumedPayments.insertIfAbsent({
        chainId,
        paymentId: payment.paymentId,
        paymentAddress: payment.paymentAddress,
        txHash: payment.txHash,
      });

      return inserted
        ? { ok: true, result: undefined }
        : {
            ok: false,
            reason: "payment-already-consumed",
          };
    },
  };
}

const authorizationConfig = {
  ...paymentConfig,
  consumer: DatabaseOnce(chainId),
  terms,
} satisfies PaymentAuthorizationConfig;

const fetchRoute = payable({ ...authorizationConfig, handler });
const authorizer = new PaymentAuthorizer(authorizationConfig);
const frameworkRoute = frameworkController(authorizer, handler);
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

```ts
import { None } from "d402/server";

const authorizationConfig = {
  ...paymentConfig,
  terms,
  consumer: None,
} satisfies PaymentAuthorizationConfig;

const handler: PayableHandler = async (_request, context) =>
  Response.json(await entitlements.read(context.payment.paymentId));

const fetchRoute = payable({ ...authorizationConfig, handler });
const authorizer = new PaymentAuthorizer(authorizationConfig);
const frameworkRoute = frameworkController(authorizer, handler);
```

## Limited Reuse

Store a usage count when one payment buys a fixed number of uses.

```ts
const authorizationConfig = {
  ...paymentConfig,
  terms,
} satisfies PaymentAuthorizationConfig;

const handler: PayableHandler = async (_request, context) => {
  const usageKey = [
    context.paymentRequest.chainId,
    context.payment.paymentId,
    context.payment.paymentAddress,
    context.payment.txHash,
  ].join(":");

  const usage = await db.paymentUsage.incrementIfBelowLimit(usageKey, 100);
  return usage.allowed
    ? Response.json(await fulfillUse())
    : Response.json({ error: "payment-quota-exhausted" }, { status: 409 });
};

const fetchRoute = payable({ ...authorizationConfig, handler });
const authorizer = new PaymentAuthorizer(authorizationConfig);
const frameworkRoute = frameworkController(authorizer, handler);
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

## Refund Policy

`RefundPolicy` answers a different question from `VerificationPolicy`:

- `VerificationPolicy` decides whether an observed payment is acceptable for a
  paid authorization.
- `RefundPolicy` decides whether the application should approve a refund of an
  already authenticated payment.

The refund pipeline is:

```text
authenticate historical payment
-> verify the configured signer is the payee
-> observe current on-chain state
-> require FundedPayment
-> apply RefundPolicy
-> broadcast refund
```

`FundedPayment` is fixed inside `refunder()` because the contract can only take
the voluntary-refund transition from the funded state. `RefundPolicy` cannot
weaken that mechanical requirement.

The application policy receives the observed payment, historical payment
request and proof, the refund endpoint's actual HTTP request, and the optional
untrusted reason supplied by the client:

```ts
import type { RefundPolicy } from "d402/server";

const refundPolicy: RefundPolicy = {
  async verify({ request, payment, reason }) {
    const session = await sessions.require(request.headers);
    const order = await orders.findByPaymentId(payment.paymentId);

    if (order === undefined || order.customerId !== session.customerId) {
      return { ok: false, reason: "not-authorized" };
    }
    if (order.fulfilled) {
      return { ok: false, reason: "already-fulfilled" };
    }
    if (reason === "changed my mind" && !order.allowsVoluntaryReturns) {
      return { ok: false, reason: "return-not-allowed" };
    }

    return { ok: true };
  },
};
```

This is where a production application authenticates the refund caller, finds
the associated order, checks fulfillment and refund windows, reserves an
idempotency decision, or sends the request to manual review. d402 authenticates
the payment, not the person making the HTTP request. The client-provided
`reason` is policy input, not evidence.

The policy should return a decision; it should not call `refundPayment()`
itself. After approval, `refunder()` broadcasts the canonical refund action.
See the [refund guide](./refunds.md) for the complete transport and failure
contract.

## Settlement and Refund Actions

If the app needs lower-level lifecycle actions outside d402's proof
verification path, call the dPayment SDK directly from the server side.

The following examples intentionally use the dPayments SDK and the raw Ethers
provider directly. They bypass d402's `D402Signer`, `D402TxBroadcaster`, and
runtime retry policy. Use `paymentActions()` when you want d402's normal
prepared/sign/broadcast flow and centralized nonce-conflict retry.

```ts
import { DPayments } from "@rakelabs/dpayments-sdk";

const walletAddress = await signer.getAddress();
const dpayments = await DPayments.fromProvider(provider, walletAddress);
const payment = dpayments.dPayment(paymentAddress);
```

Settle after the settlement time has passed.

```ts
const tx = payment.settle(walletAddress);
const signedTx = await signer.signTransaction({
  to: tx.to,
  data: tx.data,
  value: BigInt(tx.value),
  chainId: tx.chainId,
});
const response = await provider.broadcastTransaction(signedTx);
await response.wait();
```

Refund before settlement if the server cannot fulfill the paid request.

```ts
const tx = payment.voluntaryRefund(walletAddress);
const signedTx = await signer.signTransaction({
  to: tx.to,
  data: tx.data,
  value: BigInt(tx.value),
  chainId: tx.chainId,
});
const response = await provider.broadcastTransaction(signedTx);
await response.wait();
```

The d402 server action helper also exposes common server-side lifecycle actions
for consumers, workers, and recovery flows:

```ts
const actions = paymentActions({
  adapter,
  payment: {},
});

await actions.settlePayment(paymentAddress);
await actions.refundPayment(paymentAddress);
await actions.consumePayment(paymentAddress);
await actions.submitEvidence(paymentAddress, "ipfs://QmEvidence");
await actions.appealPayment(paymentAddress);
```

Pass the same object to `Once(actions)` when either integration form needs
canonical on-chain one-shot consumption.

## Nonce ownership and concurrent broadcasts

d402 leaves nonce selection entirely to the signer supplied by the
integrator. It does not wrap signers in ethers `NonceManager`, assign explicit
nonces, or retain nonce state. Provider-specific submission errors are
classified by the broadcaster, while the d402 runtime owns bounded retry
policy.

Client executors and server action helpers privately order broadcasts made
through the same object. Independent helpers and server processes may also
share one wallet without an external nonce manager: d402's bounded
`NONCE_EXPIRED` recovery handles normal concurrent action races.

This is bounded race recovery, not persistent distributed nonce allocation.
Centralized signing or application-owned nonce coordination remains an
optional throughput and custody choice for sustained high-volume transaction
traffic; it is not required simply to run d402 across replicas.

## Structured lifecycle logging

d402 does not log by default. Supply a `logger` record sink when a client or
server worker needs payment lifecycle visibility:

```ts
import type { D402Logger } from "d402/server";

const logger: D402Logger = (record) => {
  applicationLogger[record.level](record.context, record.message);
};

const actions = paymentActions({
  adapter,
  payment: { logger },
});
```

The same option is accepted by `createD402Client()` and
`createDPaymentsExecutor()`. d402 isolates logging from payment behavior:
thrown logger errors and rejected logger promises are ignored. Records include
stable event names and shallow safe context, never signed transaction payloads,
credentials, evidence URIs, or arbitrary error properties.
