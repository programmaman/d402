# Advanced d402 Server Patterns

d402 verifies HTTP payment proofs and gives the app a verified payment context.
Your app owns access policy, storage, scheduling, retries, and any chain reads
beyond proof verification.

## Resource Binding

Set `paymentConfig.resource` to the URL or resource string the client is paying
for. d402 does not infer it automatically.

Use a string when the same payment terms protect one stable URL.

```ts
const route = payable({
  paymentConfig: {
    provider,
    resource: "https://api.example.com/reports/monthly",
  },
  terms,
  handler,
});
```

Use a function when the resource depends on the incoming request.

```ts
const route = payable({
  paymentConfig: {
    provider,
    resource: (request) => {
      const url = new URL(request.url);
      return url.href;
    },
  },
  terms: {
    chainId: 100,
    payeeAddress,
    tokenAddress: null,
    netAmount: "10000",
    settlementTimeUnixSec: "4102444800",
    agreement: { id: "report-access:v1" },
    expiresAtUnixSec: 4102444800,
  },
  handler,
});
```

The current client requires the payment request resource to match the URL it
retries. Use a stable public URL pattern and constrain it with client policy. If
your app needs host-independent product IDs, order IDs, or entitlement IDs, put
that metadata in `agreement.id`.

## One-Shot Consumption

Use this when one payment should unlock exactly one operation.

```ts
const route = payable({
  paymentConfig,
  terms,
  handler: async (_request, context) => {
    if (!context.payment) {
      return Response.json({ ok: false }, { status: 402 });
    }

    const consumptionKey = [
      context.paymentRequest.chainId,
      context.payment.paymentId,
      context.payment.paymentAddress,
      context.payment.txHash,
    ].join(":");

    const inserted = await db.consumedPayments.insertIfAbsent(consumptionKey);
    if (!inserted) {
      return Response.json(
        { error: "payment-already-consumed" },
        { status: 409 },
      );
    }

    return Response.json(await fulfillOnce());
  },
});
```

The insert must be atomic. Two simultaneous requests with the same proof should
not both pass.

## Reusable Access

Do not add a consumption store when reuse is the product behavior.

Good fits:

- Subscription access
- Session access
- Account credits
- Pay once, access many times

d402 should verify the payment. Your app should decide whether reuse is allowed.

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
verification path, call the dPayment SDK directly.

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

Refund before settlement if your app cannot fulfill the paid request.

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

The d402 server action helper also exposes common lifecycle actions:

```ts
const actions = paymentActions({ provider, signer });

await actions.settlePayment(paymentAddress);
await actions.refundPayment(paymentAddress);
await actions.submitEvidence(paymentAddress, "ipfs://QmEvidence");
await actions.appealPayment(paymentAddress);
```
