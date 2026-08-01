# d402

d402 adds verifiable on-chain payments to HTTP. A server returns a `402`
challenge, the client creates the matching dPayment, and the server authorizes
the retried request from its proof.

## Install

```sh
npm install d402 ethers
```

## 1. Protect a complete route

Use `payable()` when the protected handler can be expressed as a Fetch-style
route:

```ts
import { JsonRpcProvider, Wallet } from "ethers";
import { payable } from "d402/server";

const provider = new JsonRpcProvider(process.env.RPC_URL);
// Any ethers Signer works here, including a KMS or custody-backed signer.
const payee = new Wallet(process.env.PAYEE_PRIVATE_KEY, provider);
const terms = {
  chainId: 100,
  payeeAddress: payee.address,
  tokenAddress: null,
  netAmount: "1000000000000000",
  agreement: { id: "monthly-report:v1" },
  expiresAtUnixSec: Math.floor(Date.now() / 1000) + 300,
};

export const GET = payable({
  paymentConfig: {
    provider,
    signer: payee,
    settlementWindow: 3600,
  },
  terms,
  handler: (_request, payment) =>
    Response.json({
      report: "protected data",
      paymentId: payment.payment.paymentId,
    }),
});
```

The request URL is the payment resource by default. `terms` may also be an
async function when price or agreement data depends on the request.

## 2. Authorize inside a controller

Use `PaymentAuthorizer` when your framework or application owns the controller:

```ts
import { PaymentAuthorizer } from "d402/server";

const reportPayment = new PaymentAuthorizer({
  paymentConfig: {
    provider,
    // This may also be a KMS or custody-backed ethers Signer.
    signer: payee,
    settlementWindow: 3600,
  },
  terms,
});

export async function getReport(request: Request): Promise<Response> {
  const authorization = await reportPayment.authorize(request);

  if (authorization.response !== undefined) {
    return authorization.response;
  }

  const report = await loadReport();

  return Response.json({
    report,
    paymentId: authorization.context.payment.paymentId,
  });
}
```

`authorize()` returns a protocol `response` when the request needs a challenge,
retry, or rejection. It returns `context` only after authorization succeeds.
Express middleware, Nest guards, and other framework adapters can translate
their native request into a Fetch `Request` and use this same API.

## 3. Make each payment single-use

Routes are reusable by default. Add `Once` when one payment should authorize at
most one protected operation:

```ts
import { Once, payable, paymentActions } from "d402/server";

const actions = paymentActions({
  provider,
  // Use the payee's Wallet, KMS, or custody-backed ethers Signer.
  signer: payee,
});

const download = payable({
  paymentConfig: {
    provider,
    signer: payee,
    settlementWindow: 3600,
  },
  terms,
  consumer: Once(actions),
  handler: async () =>
    Response.json({ downloadUrl: await createDownloadUrl() }),
});
```

`Once` is an on-chain, at-most-once claim. If work must survive a crash or lost
HTTP response, store the result under `context.payment.paymentId`.

## Pay for an order

Use the default server identity when payment terms represent a stable order or
invoice. Put the order ID in the terms so retries reconstruct the same payment:

```ts
const orderRoute = payable({
  paymentConfig: {
    provider,
    // This may also be a KMS or custody-backed ethers Signer.
    signer: payee,
  },
  terms: (request) => {
    const orderId = new URL(request.url).pathname.split("/").at(-1);

    return {
      chainId: 100,
      payeeAddress: payee.address,
      tokenAddress: null,
      netAmount: "1000000000000000",
      agreement: { id: `order:${orderId}:v1` },
      expiresAtUnixSec: Math.floor(Date.now() / 1000) + 300,
    };
  },
  handler,
});
```

The same payer, order terms, and server identity produce the same payment
identity. This is useful for orders, invoices, and reusable entitlements.

## Choose independent payment identity

Use client identity for independent per-request payments. This is closer to an
x402-style flow, where each request or access attempt should create a fresh
payment instead of reusing an order identity:

```ts
import { Once, payable, paymentActions } from "d402/server";

const actions = paymentActions({
  provider,
  // Use the payee's Wallet, KMS, or custody-backed ethers Signer.
  signer: payee,
});

const independentPaymentRoute = payable({
  paymentConfig: {
    provider,
    signer: payee,
    identifier: "client",
  },
  terms,
  consumer: Once(actions),
  handler,
});
```

Client identity is separate from single-use access. Use `Once` when a payment
may authorize only one operation, and use client identity when each payment
attempt should have an independent payment identity. They can be used together
when every new payment should authorize at most one operation.

## Pay a protected route

```ts
import { JsonRpcProvider, Wallet } from "ethers";
import { createD402Client } from "d402/client";

const provider = new JsonRpcProvider(process.env.RPC_URL);
// In a browser, this can instead come from BrowserProvider.getSigner().
const signer = new Wallet(process.env.PAYER_PRIVATE_KEY, provider);
const client = await createD402Client({ provider, signer });

const response = await client.fetch(
  "https://api.example.com/reports/monthly",
);
```

Use `client.d402Fetch()` when the completed payment attempt must be persisted
for application recovery or later lifecycle decisions.

## Choose a payment flow

The most important integration guide is
[Payment flows](docs/schemes.md). It shows when to use reusable access,
single-use access, stable orders, jobs, credits, and deposits.

## Documentation

- [ELI5 protocol overview](ELI5.md)
- [Payment flows](docs/schemes.md)
- [Protocol diagrams](docs/protocol.md)
- [API reference](docs/api.md)
- [Advanced configuration](docs/advanced.md)
- [HTTP and framework integration](docs/http-integration.md)
- [Scaling and stateless deployment](docs/scaling.md)
- [Upcoming features](docs/upcoming-features.md)
- [Signing modes](docs/signing.md)
- [Refunds](docs/refunds.md)
- [Disputes](docs/disputes.md)
- [Testing](docs/testing.md)
- [Examples](examples/README.md)

## License

Apache-2.0
