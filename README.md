# d402

d402 turns HTTP `402 Payment Required` responses into verifiable
[dPayments](https://www.npmjs.com/package/@rakelabs/dpayments-sdk). A server
returns payment terms, a client creates the matching on-chain payment, and the
server verifies the proof before running the protected handler.

## Install

```sh
npm install d402 ethers
```

## Protect a resource

```ts
import { JsonRpcProvider } from "ethers";
import { payable } from "d402/server";

const provider = new JsonRpcProvider(process.env.RPC_URL);

const paidReport = payable({
  paymentConfig: {
    provider,
    confirmations: 2,
  },
  terms: {
    chainId: 100,
    payeeAddress: "0x2222222222222222222222222222222222222222",
    tokenAddress: null,
    netAmount: "1000000000000000",
    settlementTimeUnixSec: "4102444800",
    agreement: {
      id: "report:monthly:v1",
    },
    expiresAtUnixSec: Math.floor(Date.now() / 1000) + 300,
  },
  handler: (_request, context) =>
    Response.json({
      report: "protected data",
      paymentId: context.payment.paymentId,
    }),
});
```

`terms` may also be an async function of the incoming request.

## Pay for a resource

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

The client validates the challenge, creates the dPayment, and retries the
original request with its payment proof.

## Payment identity

d402 supports two existing server configurations.

### Server identity

This is the default:

```ts
paymentConfig: {
  provider,
  identifier: "server",
}
```

 Identical terms and the same authenticated payer derive
the same payment identity.

### Client identity

Use a fresh payment identity for each client payment:

```ts
paymentConfig: {
  provider,
  identifier: "client",
}
```

The server omits the request salt. The standard client generates fresh
32-byte entropy and carries it in the proof. Separate clients paying identical
terms from the same payer therefore create independent payment identities.

## Custom resource identity

By default, both sides bind payment to the request URL. When a gateway,
reverse proxy, or application namespace uses another stable identifier,
configure the same resource on both sides:

```ts
const resource = "report:monthly:v1";

const route = payable({
  paymentConfig: { provider, resource },
  terms,
  handler,
});

const client = await createD402Client({
  provider,
  signer,
  resource,
});
```

Both options also accept a resolver function. d402 treats the resolved resource
as an opaque, trimmed string.

## Reusable and single-use payments

Routes are reusable by default. To atomically claim a verified payment before
running the handler:

```ts
import { Once, payable, paymentActions } from "d402/server";

const actions = paymentActions({ provider, signer: payee });

const route = payable({
  paymentConfig: { provider, signer: payee },
  terms,
  consumer: Once(actions),
  handler,
});
```

`Once` provides an at-most-once authorization claim. It does not guarantee
exactly-once handler completion: if the process crashes after consumption,
application-owned idempotency or durable result storage must provide recovery.

## Integration boundaries

Integrators can supply:

- Dynamic payment terms and resource resolvers.
- A custom client payment executor.
- A custom server payment verifier.
- A custom payment consumer.
- Custom payment-required and verification-error response builders.
- Their own persistence, queues, caches, locks, and fulfillment model.

These are application and deployment choices, not protocol requirements.

## Documentation

- [Protocol](docs/protocol.md)
- [API reference](docs/api.md)
- [Integration patterns](docs/schemes.md)
- [Advanced server patterns](docs/advanced.md)
- [Disputes](docs/disputes.md)
- [Testing a clone](docs/testing.md)

## License

Apache-2.0