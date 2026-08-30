# d402

d402 adds verifiable on-chain payments to HTTP. A server returns a `402`
challenge, the client creates the matching dPayment, and the server authorizes
the retried request from its proof.

## Install

```sh
npm install d402 @d402/ethers ethers
```

For Viem:

```sh
npm install d402 @d402/viem viem
```

## 1. Protect a complete route

Use `payable()` when the protected handler can be expressed as a Fetch-style
route:

```ts
import { JsonRpcProvider, Wallet } from "ethers";
import { createEthersAdapter } from "@d402/ethers";
import { payable } from "d402/server";

const provider = new JsonRpcProvider(process.env.RPC_URL);
// Any ethers Signer works here, including a KMS or custody-backed signer.
// Signer is only needed if the server performs an on-chain action during the request (for example, Once consumption or refunds).
const payee = new Wallet(process.env.PAYEE_PRIVATE_KEY, provider);
const adapter = createEthersAdapter({ provider, signer: payee });
const terms = {
  chainId: 100,
  payeeAddress: payee.address,
  tokenAddress: null,
  netAmount: "1000000000000000",
  agreement: { id: "monthly-report:v1" },
  expiresAtUnixSec: Math.floor(Date.now() / 1000) + 300,
};

export const GET = payable({
  adapter,
  payment: { settlementWindow: 3600 },
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
  adapter,
  payment: { settlementWindow: 3600 },
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
  adapter,
  payment: {},
});

const download = payable({
  adapter,
  payment: { settlementWindow: 3600 },
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
  adapter,
  payment: {},
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
  adapter,
  payment: {},
});

const independentPaymentRoute = payable({
  adapter,
  payment: { identifier: "client" },
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

For a server, agent, or other unattended client, connect an ethers `Wallet` to
the provider:

```ts
import { JsonRpcProvider, Wallet } from "ethers";
import { createEthersClient } from "@d402/ethers";

const provider = new JsonRpcProvider(process.env.RPC_URL);
const signer = new Wallet(process.env.PAYER_PRIVATE_KEY, provider);
const client = await createEthersClient({ provider, signer });

const response = await client.fetch(
  "https://api.example.com/reports/monthly",
);
```

In a browser, use the signer exposed by MetaMask or another EIP-1193 wallet:

```ts
import { BrowserProvider } from "ethers";
import { createEthersClient } from "@d402/ethers";

const provider = new BrowserProvider(window.ethereum);
await provider.send("eth_requestAccounts", []);
const signer = await provider.getSigner();
const client = await createEthersClient({ provider, signer });

const response = await client.fetch(
  "https://api.example.com/reports/monthly",
);
```

The client signer is always the payer. Browser wallets prompt the user when
d402 signs a payment transaction; ERC-20 payments may also require a separate
token approval transaction.

## Native facilitation

Native facilitation separates signing from submission. The payment builder or
executor produces an unsigned `PreparedTx`, the payer's `D402Signer` signs it,
and the server's `D402TxBroadcaster` submits the opaque serialized `SignedTx`:

```text
PreparedTx
  -> D402Signer.signTx()
  -> SignedTx
  -> D402TxBroadcaster.broadcastTx()
  -> D402BroadcastResult
```

The client and server may use separate provider connections. For example, the
client-side adapter can sign while a server-side, read-only adapter broadcasts:

```ts
import { createEthersAdapter } from "@d402/ethers";
import { Facilitator } from "d402/server";

const payerAdapter = createEthersAdapter({
  provider: payerProvider,
  signer: payerWallet,
});
const serverAdapter = createEthersAdapter({ provider: serverProvider });

const signedTx = await payerAdapter.signer!.signTx(preparedTx);
const facilitator = new Facilitator(serverAdapter.broadcaster!);
const result = await facilitator.facilitate(signedTx);

if (result.ok) {
  await result.submission.waitForReceipt();
}
```

The facilitator makes one broadcast attempt. It does not sign, construct,
repair, or retry the transaction because it receives no `PreparedTx` or signer.
Normal d402 client and server action execution owns nonce-conflict retry in the
runtime and obtains a fresh signature for each retry.

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
