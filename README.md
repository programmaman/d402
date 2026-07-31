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
import { JsonRpcProvider } from "ethers";
import { payable } from "d402/server";

const provider = new JsonRpcProvider(process.env.RPC_URL);

export const GET = payable({
  paymentConfig: {
    provider,
    settlementWindow: 3600,
  },
  terms: {
    chainId: 100,
    payeeAddress: "0x2222222222222222222222222222222222222222",
    tokenAddress: null,
    netAmount: "1000000000000000",
    agreement: { id: "monthly-report:v1" },
    expiresAtUnixSec: Math.floor(Date.now() / 1000) + 300,
  },
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
  signer: payee,
});

const download = payable({
  paymentConfig: {
    provider,
    signer: payee,
    identifier: "client",
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

## Pay a protected route

```ts
import { JsonRpcProvider, Wallet } from "ethers";
import { createD402Client } from "d402/client";

const provider = new JsonRpcProvider(process.env.RPC_URL);
const signer = new Wallet(process.env.PAYER_PRIVATE_KEY, provider);
const client = await createD402Client({ provider, signer });

const response = await client.fetch(
  "https://api.example.com/reports/monthly",
);
```

Use `client.d402Fetch()` when the completed payment attempt must be persisted
for application recovery.

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
- [Signing modes](docs/signing.md)
- [Disputes](docs/disputes.md)
- [Testing](docs/testing.md)
- [Examples](examples/README.md)

## License

Apache-2.0
