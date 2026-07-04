# d402 SDK

d402 is an HTTP 402 payment protocol backed by dPayment on-chain state.
Servers publish payment terms in a `402 application/d402+json` response. Clients
decide whether the terms are acceptable, create a dPayment, retry the
request with a payment proof header, and receive the protected response after
server verification.

The package is split by role:

- `@d402/sdk/core` - shared request/proof parsing and terms hashing
- `@d402/sdk/client` - paying client and payment-proof retry flow
- `@d402/sdk/server` - payable routes, verification, and server-side actions
- `@d402/sdk/autosigner` - reserved entry point for future unattended payment flows

## Install

```sh
npm install @d402/sdk ethers
```

You also need an RPC provider for the target chain and dPayment contracts
available on that chain. Native-token payments use `tokenAddress: null`; ERC-20
payments use the ERC-20 token address.

## Server Quickstart

Wrap a route with `payable`. The route returns `402 application/d402+json` until
the request includes a valid `D402-Payment-Proof` header.

```ts
import { JsonRpcProvider } from "ethers";
import { payable } from "@d402/sdk/server";

const provider = new JsonRpcProvider(process.env.RPC_URL);

export const GET = payable({
  // 1. Payment config: chain access and the resource being purchased.
  paymentConfig: {
    provider,
    minConfirmations: 2,
    resource(request) {
      const url = new URL(request.url);
      return url.href;
    },
  },

  // 2. Terms: price, recipient, timing, and business agreement.
  terms: {
    chainId: 8453,
    payeeAddress: "0x2222222222222222222222222222222222222222",
    tokenAddress: null,
    netAmount: "10000",
    settlementTimeUnixSec: String(Math.floor(Date.now() / 1000) + 3600),
    agreement: {
      id: "report-access:v1",
      hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      uri: "ipfs://agreement",
    },
    expiresAtUnixSec: Math.floor(Date.now() / 1000) + 300,
  },

  // 3. Handler: your protected code. It runs after proof verification.
  handler: async (_request, context) => {
    return Response.json({
      ok: true,
      paymentId: context.paymentRequest.paymentId,
      paymentAddress: context.payment?.paymentAddress,
      state: context.payment?.state,
    });
  },
});
```

`paymentConfig.resource` is what the client is paying for. The current client
expects it to match the URL being retried, so `resource: (request) =>
request.url` is the safest default. Put internal product IDs, order IDs, or
version labels in `agreement.id`.

## Client Quickstart

Create a client with a provider, signer, and policy. The policy is the client's
safety check: payment creation happens only after the server's payment request
matches these limits.

```ts
import { JsonRpcProvider, Wallet } from "ethers";
import { createD402Client, D402PaymentAction } from "@d402/sdk/client";

const provider = new JsonRpcProvider(process.env.RPC_URL);
const signer = new Wallet(process.env.PAYER_PRIVATE_KEY, provider);

const client = await createD402Client({
  provider,
  signer,
  paymentConfirmations: 2,
  policy: {
    allowedChains: [8453],
    allowedPayees: ["0x2222222222222222222222222222222222222222"],
    allowedTokens: [null],
    allowedResources: [/^https:\/\/api\.example\.com\/reports\/[^/]+$/],
    maxAmount: "10000",
    maxExpiryWindowSec: 300,
    maxSettlementWindowSec: 3600,
    requireAgreementHash: true,
  },
  onAccepted: D402PaymentAction.KeepOpen,
  onRejected: D402PaymentAction.RequestRefund,
});

const response = await client.fetch("https://api.example.com/reports/123");
const body = await response.json();
```

The client flow is:

1. Send the original request.
2. If the response is not `402`, return it unchanged.
3. Parse the d402 payment request from the `402` response.
4. Validate method, resource, chain, payee, token, amount, expiry, settlement,
   and agreement policy.
5. Create a dPayment.
6. Retry the same request with `D402-Payment-Proof`.
7. Run response validation and optional payment action handling.

## Wire Format

Servers return d402 payment terms with a structured JSON media type:

```http
HTTP/1.1 402 Payment Required
Content-Type: application/d402+json
Cache-Control: no-store
```

```json
{
  "paymentRequest": {
    "version": 1,
    "resource": "https://api.example.com/reports/123",
    "method": "GET",
    "chainId": 8453,
    "payeeAddress": "0x2222222222222222222222222222222222222222",
    "tokenAddress": null,
    "netAmount": "10000",
    "settlementTimeUnixSec": "4102444800",
    "agreement": {
      "id": "report-access:v1",
      "hash": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "uri": "ipfs://agreement"
    },
    "expiresAtUnixSec": 4102441200,
    "termsHash": "0x...",
    "paymentId": "0x..."
  },
  "reason": {
    "code": "missing-proof",
    "category": "proof",
    "retryable": true,
    "message": "Payment proof is required."
  }
}
```

Clients retry with:

```http
D402-Payment-Proof: <base64url-json-proof>
```

See [docs/protocol.md](docs/protocol.md) for the field-level protocol details.

## Payment Actions

By default the client keeps successful payments open. You can configure action
handling after the protected response returns:

```ts
const client = await createD402Client({
  provider,
  signer,
  onAccepted: D402PaymentAction.Settle,
  onRejected: D402PaymentAction.Dispute,
  onResponse: {
    async validate({ response }) {
      if (!response.ok) {
        return { accepted: false, reason: `HTTP ${response.status}` };
      }

      const body = await response.clone().json();
      return body.fulfilled === true
        ? { accepted: true }
        : { accepted: false, reason: "server did not fulfill request" };
    },
  },
});
```

Servers can also settle or refund verified payment addresses:

```ts
import { paymentActions } from "@d402/sdk/server";

const actions = paymentActions({
  provider,
  signer: payeeSigner,
  actionConfirmations: 2,
});

await actions.settlePayment(paymentAddress);
await actions.refundPayment(paymentAddress);
await actions.submitEvidence(paymentAddress, "ipfs://QmEvidence");
await actions.appealPayment(paymentAddress);
```

## Documentation

- [Protocol](docs/protocol.md): payment request/proof format, status codes, and failure reasons
- [API reference](docs/api.md): exported functions, options, and types by entry point
- [Signing modes](docs/signing.md): browser wallets, services, agents, and guardrails
- [Advanced server patterns](docs/advanced.md): resource binding, one-shot consumption, reuse, settlement jobs
- [Testing and release checks](docs/testing.md): unit tests, e2e tests, Docker requirements, and packaging smoke checks
- [Runnable examples](examples/README.md): Express, Next.js, and one-shot access examples

## Development

```sh
npm run typecheck
npm test
npm run lint
```

The e2e suite is a separate package because it starts Docker containers and a
local Hardhat chain:

```sh
cd e2e_tests
npm run typecheck
npm test
```

The e2e suite requires the `cartel-hardhat:test` Docker image.
