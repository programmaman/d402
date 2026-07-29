# d402 Integration Patterns

This guide shows how to build common paid HTTP products with d402. Every pattern below has been tested against a dPayments contract.

These are integration patterns, not negotiated wire-level "schemes." d402 has
one verification model. Integrators choose payment identity, consumption, and
application state to produce the behavior their endpoint needs.

## The Three Decisions

Every integration starts with three decisions:

1. Should identical terms from the same payer identify the same payment?
2. May one payment authorize more than one request?
3. What business state must the application store after verification?

Use server identity when a payment belongs to a stable invoice, order,
subscription, entitlement, or other business object:

```ts
const route = payable({
  paymentConfig: {
    provider,
    identifier: "server",
  },
  terms,
  handler,
});
```

`"server"` is the default. The server includes the canonical salt, so identical
terms and the same authenticated payer reconstruct the same payment identity.

Use client identity when each purchase should create an independent payment,
even if multiple clients receive identical terms:

```ts
const route = payable({
  paymentConfig: {
    provider,
    identifier: "client",
  },
  terms,
  handler,
});
```

The server omits the salt and the standard client generates fresh entropy for
each payment.

Routes are reusable by default. Add `Once` only when a payment may authorize at
most one protected operation:

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
  handler,
});
```

`Once` is an on-chain authorization claim. It does not guarantee that the
handler completes exactly once. Durable operation state and result recovery
remain application responsibilities.

## Tested Patterns

| Pattern | Identity | Consumption | Application-owned state |
| --- | --- | --- | --- |
| Stable invoice | Server | Reusable | Invoice and fulfillment status |
| Existing order checkout | Server | App policy | Order and fulfillment status |
| Fixed quote execution | Server | App policy | Quote scope, expiry, and execution |
| Reusable access pass | Server | Reusable | Entitlement and access policy |
| Prepaid subscription | Server | Reusable | Subscriber, period, and cancellation |
| Prepaid credit top-up | Server | Reusable proof, idempotent credit | Customer balance and credited payment IDs |
| Limited-use bundle | Server | Reusable | Atomic remaining-use counter |
| Prepaid metered session | Server | Reusable | Atomic unit balance and usage records |
| Anonymous pay-once | Client | `Once` | Fulfillment result or recovery record |
| Anonymous pay-per-use | Client | One payment per access | Optional request/result records |
| Paid computation | Client | App policy | Job and result keyed by payment ID |
| Asynchronous fulfillment | Client | App policy | Queue, job status, and result |
| Non-idempotent paid action | Client | `Once` | Durable operation and recovery state |
| Reservation deposit | Usually server | Reusable | Reservation and refund status |
| Escrowed service | Usually server | Reusable | Delivery acceptance and settlement status |
| Sponsored checkout | Server or client | Product policy | Beneficiary or account binding |
| Canonical-salt validation | Server | Not applicable | No additional state |

## Stable Commerce Objects

Invoices, orders, and fixed quotes already have a durable application identity.
Put that identity in `agreement.id`, publish fixed economic terms, and use
server identity.

```ts
const orderCheckout = payable({
  paymentConfig: {
    provider,
    resource: ({ url }) => `order:${new URL(url).searchParams.get("orderId")}`,
  },
  terms: async (request) => {
    const order = await orders.loadRequired(request);

    return {
      chainId,
      payeeAddress,
      tokenAddress: null,
      netAmount: order.amountWei,
      settlementTimeUnixSec: order.settlementTimeUnixSec,
      agreement: {
        id: `order:${order.id}:v${order.priceVersion}`,
      },
      expiresAtUnixSec: order.quoteExpiresAtUnixSec,
    };
  },
  handler: async (_request, context) => {
    const result = await orders.markPaidIdempotently({
      paymentId: context.payment.paymentId,
      paymentAddress: context.payment.paymentAddress,
    });

    return Response.json(result);
  },
});
```

The database transition must still be idempotent. A reusable proof can be
presented again, and an HTTP response can be lost after fulfillment succeeds.

## Reusable Access and Subscriptions

A verified payment can act as an entitlement key. Keep the route reusable and
store the product rules in the application:

```ts
handler: async (_request, context) => {
  const entitlement = await entitlements.loadOrCreate({
    paymentId: context.payment.paymentId,
    payerAddress: context.payment.payerAddress,
  });

  if (!entitlement.active) {
    return Response.json({ error: "entitlement-inactive" }, { status: 403 });
  }

  return Response.json(await loadPremiumResource());
}
```

d402 proves the payment. The application defines the subscription period,
account association, renewal, cancellation, and access rules.

## Credits, Bundles, and Metering

Credit top-ups should record the payment ID and update the customer balance in
one atomic transaction:

```ts
await db.transaction(async (tx) => {
  const inserted = await tx.creditedPayments.insertIfAbsent(
    context.payment.paymentId,
  );

  if (inserted) {
    await tx.balances.increment(customerId, purchasedCredits);
  }
});
```

Bundles and metered sessions use the verified payment ID as the purchased
balance key. Their decrement must also be atomic so concurrent replicas cannot
spend the same remaining units.

d402 does not prescribe a database, cache, lock, or ledger. Those choices can
match a monolith, modulith, or horizontally scaled deployment.

## Anonymous Pay-Per-Use

Use client identity when identical public requests should create independent
payments:

```ts
const paidSearch = payable({
  paymentConfig: {
    provider,
    identifier: "client",
  },
  terms: searchTerms,
  handler: runSearch,
});
```

Use `Once` as well when each payment buys exactly one authorization. Leave the
route reusable when the payment buys a session, result retrieval, or another
repeatable entitlement.

## Computation and Asynchronous Jobs

Client identity lets a client pay before an application job ID exists. After
verification, create or recover the job using the payment ID:

```ts
handler: async (_request, context) => {
  const job = await jobs.getOrCreate(
    context.payment.paymentId,
    () => queueComputation(context.payment.paymentId),
  );

  return Response.json(
    {
      jobId: job.id,
      status: job.status,
    },
    { status: 202 },
  );
}
```

The payment ID makes a lost response recoverable: a retry with the same proof
can return the existing job instead of submitting the work twice.

For strict one-shot authorization, add `Once`. If consuming succeeds and the
process crashes before creating the job, the application needs a recovery
worker or durable operation record.

## Deposits, Refunds, and Escrow

Use server identity when a deposit belongs to an existing reservation or
service agreement. Store the payment address with the business object, then run
lifecycle actions from an authorized server process:

```ts
import { paymentActions } from "d402/server";

const actions = paymentActions({ provider, signer: payee });

await actions.refundPayment(paymentAddress);
await actions.settlePayment(paymentAddress);
```

Typical application transitions are:

```text
reservation created -> deposit funded -> held -> refunded
service accepted -> payment funded -> delivery accepted -> settled
```

The chain is authoritative for payment state. The application remains
authoritative for reservation, delivery, and workflow state.

## Sponsored Payments

The HTTP caller does not have to be the payer. The verifier authenticates
`context.payment.payerAddress` from the canonical on-chain creation event.

```ts
handler: async (request, context) => {
  const beneficiary = authenticateCaller(request);

  await purchases.record({
    beneficiary,
    payerAddress: context.payment.payerAddress,
    paymentId: context.payment.paymentId,
  });

  return Response.json({ beneficiary, sponsored: true });
}
```

This supports corporate wallets, relayers, parents, sponsors, and delegated
buyers without trusting a caller-supplied payer address.

## Security and Recovery Rules

- Treat `context.payment` as the authenticated payment result. Do not trust
  payer, payment ID, or payment address values copied from ordinary request
  fields.
- Use server identity only when identical terms should reconstruct one payment.
  Use client identity when each purchase must be independent.
- Keep reusable routes free of consumption. Use `Once` only for at-most-once
  authorization.
- Make balances, quotas, order transitions, and job creation atomic and
  idempotent in application storage.
- Key recoverable work by verified payment identity, not payer address alone.
- Persist the payment address when later settlement, refund, dispute, evidence,
  or appeal operations are part of the product.

## Protocol Boundary

d402 answers:

> Was a usable on-chain payment created for these exact HTTP payment terms, and
> who actually created it?

With `Once`, it can additionally answer:

> Has the payee already claimed this payment for fulfillment?

The application answers:

> What does the payment unlock, how much remains, and what result should be
> returned or recovered?

That boundary is what lets integrators scale storage, queues, caching, locking,
and fulfillment independently from the protocol.