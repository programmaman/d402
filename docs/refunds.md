# d402 Refunds

d402 standardizes the payment-authenticated mechanics of a refund. Applications
still decide whether a mechanically refundable payment should be refunded by
providing a `RefundPolicy`.

## Route configuration

The payable route advertises its refund endpoint:

```ts
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

router.get("/resource", payable(routeConfig));
router.post("/refund", refunder(routeConfig, refundPolicy));
```

`D402RefundRoute.url` may be relative or an absolute HTTP or HTTPS URL.
Credentials and fragments are rejected. The refunder reuses the original
route configuration; it does not invoke the terms resolver or protected
handler.

## Refund request

When a paid response is rejected and the client uses `RequestRefund`, the SDK
sends this request to the advertised route:

```ts
interface D402RefundRequest {
  paymentRequest: D402PaymentRequest;
  paymentProof: D402PaymentProof;
  reason?: string;
}
```

The historical payment request and proof are sufficient to derive and
authenticate the payment. Challenge expiry is not re-evaluated. The protected
response, original HTTP request, and a separate client-supplied payment address
are not transmitted.

## Refunder

Before policy runs, `refunder()`:

- parses the refund request strictly;
- verifies payment salt and derived identity;
- authenticates the historical creation transaction and event;
- verifies chain, factory, address, payee, token, amount, settlement time,
  confirmations, and any settlement reference;
- observes current on-chain state;
- verifies the configured signer controls the authenticated payee; and
- applies the public `FundedPayment` verification policy, which requires
  the payment to remain funded.

If policy approves, the refunder calls `paymentActions().refundPayment()` and
returns its confirmed transaction hash.

`FundedPayment` uses the same `ObservedPaymentContext` →
`VerificationPolicy` seam as `payable()`. It is not replaceable inside
`refunder()`, because the on-chain refund transition always requires the funded
state. Integrators may also use it explicitly as a normal payable route's
`verificationPolicy` when that route should accept only still-refundable
payments.

## Refund policy

```ts
const refundPolicy: RefundPolicy = {
  async verify({ request, payment, paymentRequest, reason }) {
    const session = await authenticateApplicationRequest(request);
    const order = await orders.findByPaymentId(payment.paymentId);

    if (order === undefined || order.customerId !== session.customerId) {
      return { ok: false, reason: "not-authorized" };
    }
    if (order.fulfilled) {
      return { ok: false, reason: "already-fulfilled" };
    }

    void paymentRequest;
    void reason;
    return { ok: true };
  },
};
```

Policy owns HTTP caller authorization, application state, refund windows,
fulfillment decisions, application idempotency, and manual review. There is no
refund consumer, recovery hook, requester-authenticator hook, or separate
refunder configuration.

The contract remains the final authority on whether the refund transition can
occur. Concurrent attempts cannot both successfully refund the same payment.
