# d402 Disputes

A dispute is the on-chain escalation path for a rejected protected response.
It is not the same thing as publishing evidence, requesting a refund, or
receiving a final ruling.

## Lifecycle

1. The client creates and funds a dPayment.
2. The client retries the protected request with a payment proof.
3. The server returns a protected response.
4. The client validates the response. If it is rejected, the client chooses one
   of these actions:
   - `KeepOpen`: leave the payment open.
   - `RequestRefund`: ask the server to evaluate a refund request.
   - `Dispute`: raise the on-chain dispute.
5. If disputed, the payment enters the on-chain `disputed` state and receives a
   dispute ID from the underlying dPayment system.
6. The parties publish evidence off-chain and submit the resulting evidence
   URI on-chain.
7. An authorized server actor may appeal when the court permits an appeal.
8. The court resolves the dispute. The application records the final ruling
   and resulting fund movement.

`disputed` is an intermediate state, not an outcome. A completed integration
should distinguish at least:

- `refunded-to-payer`
- `resolved-to-payee`

The current d402 verifier exposes a coarser `resolved` state because the
underlying resolution outcome is not yet modeled in d402.

## Responsibilities

### d402

- Verify payment creation and live payment state.
- Initiate a dispute through the client executor.
- Submit an evidence URI through `paymentActions().submitEvidence()`.
- Provide server-side appeal and settlement/refund transaction helpers.
- Reject access for disputed or resolved payments.

### Evidence publisher

[`@rakelabs/evidence-publisher`](https://www.npmjs.com/package/@rakelabs/evidence-publisher)
packages evidence documents and publishes them to IPFS-compatible storage. It
does not create disputes or decide rulings.

Evidence storage is intentionally outside d402 core. Applications should keep
the payment ID, payment address, resource, request/response context, evidence
publication result, and submission transaction associated in their own records.

### Court or arbitration system

The court handles juror review, appeals, and the final ruling. d402 does not
interpret the court's policy or decide which party is correct.

### Application

The application owns dispute policy, refund approval, persistence, replay and
idempotency handling, notifications, and mapping the court ruling to a
business outcome.

## Evidence flow

```ts
const result = await evidencePublisher.publish({
  title: `d402 evidence for ${paymentId}`,
  description: "Service was not delivered for the protected resource.",
  attachment: {
    bytes: evidenceBytes,
    fileName: "evidence.json",
    mediaType: "application/json",
    fileTypeExtension: "json",
  },
});

await actions.submitEvidence(paymentAddress, result.document.uri);
```

Until d402 defines a canonical evidence-manifest schema, the application is
responsible for binding the published evidence to the payment and protected
resource and for retaining the returned publication metadata.

Clients may also submit a published evidence URI explicitly through their
payment executor:

```ts
const result = await executor.submitEvidence(payment, evidenceUri);
```

This does not publish the evidence or create its manifest. The client wallet
must be authorized by the underlying dPayment contract. Evidence submission is
not automatic after `Dispute`; the application chooses when and what to submit.
