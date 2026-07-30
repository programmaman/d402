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

### Dynamic settlement timing

For a settlement time relative to payment creation, configure a settlement
window instead of an absolute settlement timestamp:

```ts
paymentConfig: {
  provider,
  settlementWindow: 3600,
}
```

## Pay for a resource

```ts
import { JsonRpcProvider, Wallet } from "ethers";
import { createD402Client } from "d402/client";

const provider = new JsonRpcProvider(process.env.RPC_URL);
const signer = new Wallet(process.env.PAYER_PRIVATE_KEY, provider);
const client = await createD402Client({ provider, signer });

const { response, payment } = await client.d402Fetch(
  "https://api.example.com/reports/monthly",
);

if (payment !== undefined) {
  // Persist payment before using the response when delivery recovery matters.
  await savePaymentAttempt(payment);
}
```

The client validates the challenge, creates the dPayment, and retries the
original request with its payment proof. `client.fetch()` remains available
when only the `Response` is needed. Use `client.d402Fetch()` when payment
attempt data must be retained for recovery; see the API reference for retry
handling after a paid request fails.

## Local policy and logging

Pass `policy` to constrain unattended or user-approved payment execution.
Policy configuration is validated when `createD402Client()` is called, before
any provider or network work. Amount caps must be non-negative integers,
chain IDs must be positive safe integers, and expiry/settlement windows must
be non-negative safe integers. Resource regular expressions are evaluated
without retaining mutable `lastIndex` state between requests.

d402 is silent by default. Set `logger` on the client, server payment config,
or direct dPayments executor to receive structured lifecycle records. Logger
failures are intentionally ignored so observability cannot change payment
behavior. See the [API reference](docs/api.md#logging) for the record shape.

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
  paymentConfig: { provider },
  terms: {
    ...terms,
    resource,
  },
  handler,
});

const client = await createD402Client({
  provider,
  signer,
  resource,
});
```

`terms.resource` also accepts a resolver for dynamic routes:

```ts
terms: {
  ...terms,
  resource: (request) => {
    const { pathname } = new URL(request.url);
    return `order:${pathname}`;
  },
}
```

d402 treats the resolved resource as an opaque, trimmed string. The terms
resolver and `terms.resource` each receive their own request clone as both the
first argument and `context.bodyRequest`. Framework integrations can read
subtype-specific metadata from `context.originalRequest`:

```ts
import type { NextRequest } from "next/server";

const route = payable<NextRequest>({
  paymentConfig: { provider },
  terms: async (
    _request,
    { originalRequest, bodyRequest },
  ) => {
    const body = await bodyRequest.json() as {
      reportId: string;
    };

    return {
      ...terms,
      agreement: {
        id:
          `report:${originalRequest.nextUrl.pathname}:${body.reportId}`,
      },
    };
  },
  handler,
});
```

Read bodies from the clone, not `originalRequest`, so the original body remains
available to the protected handler.

## Reusable and single-use payments

Routes are reusable by default. To atomically claim a verified payment before
running the handler, create the server payment actions once and pass them to
`Once`:

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

The same `actions` object exposes settlement, refund, evidence, and appeal
methods for server lifecycle workers.

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
