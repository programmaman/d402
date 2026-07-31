# d402 Refunds

d402 standardizes the payment-authenticated mechanics of requesting and
executing a refund. The protocol proves which on-chain payment the request
refers to and whether that payment can still be refunded. The application
decides whether it should be refunded.

This creates two distinct policy boundaries:

| Policy | Question answered | Configuration |
| --- | --- | --- |
| `FundedPayment` | Can this payment still take the on-chain refund transition? | Fixed inside `refunder()` |
| `RefundPolicy` | Should this application approve this refund request? | Supplied by the integrator |

`FundedPayment` requires the observed payment state to be exactly `funded`.
It uses the same `ObservedPaymentContext` and `VerificationPolicy` interface as
the payable flow. A refund route cannot replace it with a weaker policy.

## Configure a refund route

Define the payable route once, advertise its refund URL, and pass that same
configuration to `payable()` and `refunder()`:

```ts
import {
  payable,
  refunder,
  type PayableRouteConfig,
  type RefundPolicy,
} from "d402/server";

const routeConfig = {
  paymentConfig: {
    provider,
    signer: payee,
  },
  terms,
  refunds: {
    url: "/refund",
  },
  handler,
} satisfies PayableRouteConfig;

const refundPolicy = {
  async verify({ request, payment }) {
    const session = await authenticateSession(request);
    const order = await orders.findByPaymentId(payment.paymentId);

    if (order === undefined || order.customerId !== session.customerId) {
      return { ok: false, reason: "not-authorized" };
    }
    if (order.fulfilled) {
      return { ok: false, reason: "already-fulfilled" };
    }

    return { ok: true };
  },
} satisfies RefundPolicy;

const resourceRoute = payable(routeConfig);
const refundRoute = refunder(routeConfig, refundPolicy);
```

Mount `resourceRoute` on the protected resource and `refundRoute` at the URL
advertised by `routeConfig.refunds`. Framework adapters may wrap these Fetch
API request handlers as usual.

`D402RefundRoute.url` may be relative or an absolute HTTP or HTTPS URL. A
relative URL is resolved against the URL that returned the payment challenge.
Credentials and fragments are rejected.

For cross-origin preflight, cookies, and bearer credentials on the refund
request, see [HTTP and Framework Integration](./http-integration.md).

The original route configuration is reused for its provider, signer, and
payment-verification settings. The refund handler does not invoke the original
terms resolver, recovery hook, consumer, or protected handler.

## Configure the client

Refund requests are opt-in. Set the rejected-response action to
`RequestRefund`:

```ts
import {
  createD402Client,
  D402PaymentAction,
} from "d402/client";

const client = await createD402Client({
  provider,
  signer: payer,
  onRejected: D402PaymentAction.RequestRefund,
});

const response = await client.fetch(resourceUrl);
```

The default response validator accepts successful HTTP responses and rejects
non-success responses with a reason such as `HTTP 500`. After a paid response
is rejected, `client.fetch()` sends the refund request to the URL advertised in
the original payment challenge.

The challenge must advertise `refunds` when `RequestRefund` is configured. The
client checks this before creating the payment. A successful refund does not
replace the protected resource response: `client.fetch()` still returns that
original response after the refund transaction is confirmed.

`client.d402Fetch()` and `client.retry()` only perform the payment exchange.
They do not run response validation or automatic post-response actions.

Use `d402Fetch()` followed by `requestRefund()` when the application needs to
inspect the response, ask for user approval, or delay the refund request:

```ts
const { response, payment } = await client.d402Fetch(resourceUrl);

if (payment !== undefined && await approveRefund(response)) {
  await client.requestRefund(payment, "User approved refund");
}
```

`requestRefund()` uses the refund route retained from the original challenge
and the same canonical transport as automatic `RequestRefund`. It does not
accept a replacement route or transport callback. Applications that use a
different transport own that separate workflow outside the d402 refund
protocol.

## Refund request contract

The client sends an HTTP `POST` with content type
`application/d402-refund+json` and this body:

```ts
interface D402RefundRequest {
  paymentRequest: D402PaymentRequest;
  paymentProof: D402PaymentProof;
  reason?: string;
}
```

The request contains the historical payment request that created the payment,
its creation proof, and the optional reason produced by the client's response
validator. The reason is untrusted application-policy input; it is not payment
authentication evidence.

The historical payment request and proof are sufficient to derive and
authenticate the on-chain payment. The refund handler does not re-evaluate the
historical challenge expiry. It verifies that the payment was validly created,
not that the old challenge would still be valid for creating a new payment.

The following are deliberately not sent:

- the protected resource response;
- the original protected-resource HTTP request; or
- a separate client-selected payment address.

The `request` received by `RefundPolicy` is the new HTTP request made to the
refund endpoint. The refunder parses a clone, so the policy may still read its
headers or body.

## Server verification sequence

For each request, `refunder()`:

1. Strictly parses the `D402RefundRequest`.
2. Verifies the payment salt and derived payment identity.
3. Authenticates the on-chain creation transaction and event, including chain,
   factory, payment address, payee, token, amount, settlement time,
   confirmations, and any settlement reference.
4. Verifies that the configured signer controls the authenticated payee.
5. Observes the payment's current on-chain state.
6. Applies `FundedPayment` to the resulting `ObservedPaymentContext`.
7. Runs the application-provided `RefundPolicy`.
8. Calls `paymentActions().refundPayment()` and returns the confirmed
   transaction hash.

A successful response is:

```json
{
  "txHash": "0x..."
}
```

## Application refund policy

`RefundPolicy` receives the authenticated and observed payment context plus the
refund endpoint's HTTP request and optional client reason:

```ts
interface RefundPolicyContext extends ObservedPaymentContext {
  request: Request;
  reason?: string;
}
```

This is the application seam for rules such as:

- authenticating or identifying the HTTP caller;
- associating the payment with an order or account;
- refund windows and fulfillment state;
- application idempotency and manual review; and
- deciding whether the client-provided reason is acceptable.

d402 does not authenticate the refund requester as a protocol identity. It
authenticates the payment. If caller authentication is required, implement it
inside `RefundPolicy` using the refund HTTP request.

## Failures and concurrency

The refund endpoint uses these status classes:

| Status | Meaning |
| --- | --- |
| `400` | Invalid content type or refund request body |
| `403` | The signer is not the payee, or `RefundPolicy` rejected the request |
| `409` | The observed payment is not funded and therefore is not refundable |
| `422` | The submitted payment request and proof failed canonical verification |
| `425` | The payment is not yet observable with the required confirmations |
| `503` / `504` | The chain provider failed or timed out |

If the refund endpoint fails, `client.fetch()` throws `D402PaymentError`
because a payment and proof already exist. Its `cause` is a
`D402RefundRequestError`, which retains the refund endpoint response.

There is no refund-specific recovery hook, consumer, caller authenticator, or
separate refunder configuration. Application idempotency belongs in
`RefundPolicy`. The contract remains the final authority over the state
transition: concurrent requests may race, but they cannot both successfully
refund the same payment.

## Reusing `FundedPayment`

`FundedPayment` is also exported for ordinary payable routes. Use it when a
protected route should accept only payments that remain funded:

```ts
import { FundedPayment, payable } from "d402/server";

const route = payable({
  ...routeConfig,
  verificationPolicy: FundedPayment,
});
```

The default payable policy is `FundedOrSettledPayment`, which accepts either
state.
