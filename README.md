# d402 SDK

d402 is an HTTP 402 payment protocol backed by dPayment on-chain state.
It supports EVM deployments on Gnosis and Ethereum.
Servers publish payment terms in a `402 application/d402+json` response. Clients
decide whether the terms are acceptable, create a dPayment, retry the
request with a payment proof header, and receive the protected response after
server verification.

The package is split by role:

- `d402/core` - shared request/proof parsing and terms hashing
- `d402/client` - paying client and payment-proof retry flow
- `d402/server` - payable routes, verification, and server-side actions
- `d402/autosigner` - reserved entry point for future unattended payment flows

See [why d402 is better suited for payment-gated HTTP resources than x402 or
Visa Trusted Agent Protocol](docs/comparisons.md) for the protocol comparison
and threat-model analysis.

## Install

```sh
npm install d402 ethers
```

You also need an RPC provider for the target chain and dPayment contracts
available on that chain. d402 currently supports Gnosis and Ethereum. Native-token
payments use `tokenAddress: null`; ERC-20 payments use the ERC-20 token address.

## Protect A Route And Return A Paid Response

Wrap a route with `payable`. The route returns `402 application/d402+json` until
the request includes a valid `D402-Payment-Proof` header.

```ts
import { JsonRpcProvider } from "ethers";
import { payable } from "d402/server";

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
    chainId: 100,
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

Payment creation and server verification default to one included block.
The server may return `402` with an insufficient-confirmations reason until the
payment reaches that threshold. Set `paymentConfig.minConfirmations` or the
client confirmation options explicitly when stronger finality is appropriate.

If the app wants settlement timing relative to the latest block instead of a
fixed timestamp, set `paymentConfig.settlementWindow` and omit
`settlementTimeUnixSec`. d402 will derive the settlement time from the chain.

## Pay The 402 And Retry

Create a client with a provider, signer, and policy. The policy is the client's
safety check: payment creation happens only after the server's payment request
matches these limits.

```ts
import { JsonRpcProvider, Wallet } from "ethers";
import { createD402Client, D402PaymentAction } from "d402/client";

const provider = new JsonRpcProvider(process.env.RPC_URL);
const signer = new Wallet(process.env.PAYER_PRIVATE_KEY, provider);

const client = await createD402Client({
  provider,
  signer,
  paymentConfirmations: 2,
  policy: {
    allowedChains: [100],
    allowedPayees: ["0x2222222222222222222222222222222222222222"],
    allowedTokens: [null],
    allowedResources: [/^https:\/\/api\.example\.com\/reports\/[^/]+$/],
    maxAmount: "10000",
    maxExpiryWindowSec: 300,
    minSettlementWindowSec: 60,
    requireAgreementHash: true,
  },
  onAccepted: D402PaymentAction.KeepOpen,
});

const response = await client.fetch("https://api.example.com/reports/123");
const body = await response.json();
```

The happy path is:

1. Send the original request.
2. If the response is not `402`, return it unchanged.
3. Parse the d402 payment request from the `402` response.
4. Validate method, resource, chain, payee, token, amount, expiry, settlement,
   and agreement policy.
5. Create a dPayment.
6. Retry the same request with `D402-Payment-Proof`.
7. Return the protected response.

## Store Payment Metadata And Settle Later

In a real app, the server keeps a payment record for later settlement or refund
handling, and the client either keeps the payment open or settles it after the
response comes back.

```ts
import { JsonRpcProvider, Wallet } from "ethers";
import { payable, paymentActions } from "d402/server";

const provider = new JsonRpcProvider(process.env.RPC_URL);
const payee = new Wallet(process.env.PAYEE_PRIVATE_KEY, provider);

type PaymentRecord = {
  paymentId: string;
  paymentAddress: `0x${string}`;
  payerAddress: `0x${string}`;
  state: string;
  settledAt: Date | null;
};

const paymentStore = {
  // Store the payment record when the protected response is generated.
  async upsert(record: PaymentRecord) {
    // Replace with your DB client: Prisma, SQL, Drizzle, etc.
  },
  // Return payments that are ready to be settled by a background worker.
  async listReadyForSettlement() {
    return [] as PaymentRecord[];
  },
  // Mark the payment as settled after the on-chain action succeeds.
  async markSettled(paymentId: string, settledAt: Date) {
    // Replace with an UPDATE in your DB.
  },
};

export const GET = payable({
  paymentConfig: {
    provider,
    resource: (request) => request.url,
    settlementWindow: 3600,
  },
  terms: async (request) => ({
    chainId: 100,
    payeeAddress: payee.address,
    tokenAddress: null,
    netAmount: "10000",
    agreement: { id: "report-access:v1" },
    expiresAtUnixSec: Math.floor(Date.now() / 1000) + 300,
  }),
  handler: async (_request, context) => {
    await paymentStore.upsert({
      paymentId: context.paymentRequest.paymentId,
      paymentAddress: context.payment?.paymentAddress as `0x${string}`,
      payerAddress: context.payment?.payerAddress as `0x${string}`,
      state: context.payment?.state ?? "open",
      settledAt: null,
    });

    return Response.json({
      report: "123",
      data: "ready",
    });
  },
});

async function settleReadyPayments() {
  // Settle ready payments in a background job or queue worker.
  const actions = paymentActions({
    provider,
    signer: payee,
  });

  for (const payment of await paymentStore.listReadyForSettlement()) {
    if (payment.settledAt !== null) {
      continue;
    }

    await actions.settlePayment(payment.paymentAddress);
    await paymentStore.markSettled(payment.paymentId, new Date());
  }
}
```

That pattern is the common one: the payment opens the gate, the server records
the on-chain identifiers, and a later worker settles or refunds based on your
business rules. When you use `settlementWindow`, the server derives the
settlement time from the latest block and the settlement job can act once that
window has passed.

d402 handles the payment handshake and verification. The app still owns the
business layer around that verified payment: what it buys, whether it is
reusable, how it is stored, and what later settlement or refund behavior should
look like.

Clients can also be configured to auto-settle after they inspect the protected
response, or to keep the payment open. That lets the protocol support
negotiation-style flows instead of only one-shot payment-and-finish
interactions. Refunds are handled on the server side.

## Add Custom Validation Or Refund Logic

Start with the happy path. Add these hooks only when the app needs extra policy
or recovery behavior.

Use `onResponse` when the client must inspect the protected response before
auto-settling a payment.

```ts
const client = await createD402Client({
  provider,
  signer,
  onAccepted: D402PaymentAction.Settle,
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

Use `paymentActions()` on the server side when a worker or recovery path needs
to settle, refund, submit evidence, or appeal a verified payment.

```ts
import { paymentActions } from "d402/server";

const actions = paymentActions({
  provider,
  signer: payeeSigner,
  actionConfirmations: 2,
});

await actions.refundPayment(paymentAddress);
```

### Publish Evidence

d402 does not own evidence storage or IPFS pinning. Use the companion
[`@rakelabs/evidence-publisher`](https://www.npmjs.com/package/@rakelabs/evidence-publisher)
package to create and publish an evidence manifest, then submit the resulting
URI through `paymentActions().submitEvidence()`:

```ts
import { createEvidencePublisher } from "@rakelabs/evidence-publisher";

const publisher = await createEvidencePublisher();
const evidence = await publisher.publish({
  title: `d402 evidence for ${paymentId}`,
  description: "Service was not delivered for the protected resource.",
  attachment: {
    bytes: evidenceBytes,
    fileName: "evidence.json",
    mediaType: "application/json",
    fileTypeExtension: "json",
  },
});

await actions.submitEvidence(paymentAddress, evidence.document.uri);
```

The publisher handles evidence packaging and storage. d402 remains storage
agnostic and handles the payment and on-chain evidence-submission boundary.

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
    "chainId": 100,
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
See [docs/disputes.md](docs/disputes.md) for the dispute lifecycle, evidence
flow, appeals, and resolution responsibilities.

## Documentation

- [Protocol](docs/protocol.md): payment request/proof format, status codes, and failure reasons
- [Disputes](docs/disputes.md): dispute lifecycle, evidence, appeals, and resolution outcomes
- [API reference](docs/api.md): exported functions, options, and types by entry point
- [Signing modes](docs/signing.md): browser wallets, services, agents, and guardrails
- [Advanced server patterns](docs/advanced.md): resource binding, one-shot consumption, reuse, settlement jobs
- [Protocol comparisons](docs/comparisons.md): d402 compared with x402 and Visa Trusted Agent Protocol
- [Runnable examples](examples/README.md): Express, Next.js, and one-shot access examples
