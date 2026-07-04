# Signing Modes

d402 does not own wallet connection UI. The client sends dPayment transactions
through the `ethers` signer that the app provides.

This lets the same client work for web3 users, web2 services, and agents.

## Web3 Wallets

Use your app's wallet connector to get an ethers signer. Browser wallets,
WalletConnect, and hardware wallets can prompt the user when
`signer.sendTransaction(...)` is called.

```ts
import { BrowserProvider } from "ethers";
import { createD402Client, D402PaymentAction } from "@d402/sdk/client";

const provider = new BrowserProvider(window.ethereum);

await provider.send("eth_requestAccounts", []);
const signer = await provider.getSigner();

const client = await createD402Client({
  provider,
  signer,
  policy: {
    allowedChains: [8453],
    allowedPayees: ["0x2222222222222222222222222222222222222222"],
    allowedTokens: [null],
    maxAmount: "10000",
    allowedResources: [/^https:\/\/api\.example\.com\/reports\/[^/]+$/],
    maxExpiryWindowSec: 300,
    maxSettlementWindowSec: 3600,
    requireAgreementHash: true,
  },
  onAccepted: D402PaymentAction.KeepOpen,
  onRejected: D402PaymentAction.Dispute,
});

const response = await client.fetch("/api/reports/123");
```

## Web2 Services

Use a programmatic signer when the app owns payment execution. This can be an
`ethers.Wallet`, KMS signer, custodial wallet, or another signer that can send
transactions without wallet popups.

```ts
import { JsonRpcProvider, Wallet } from "ethers";
import { createD402Client, D402PaymentAction } from "@d402/sdk/client";

const provider = new JsonRpcProvider(process.env.RPC_URL);
const signer = new Wallet(process.env.PAYER_PRIVATE_KEY, provider);

const client = await createD402Client({
  provider,
  signer,
  policy: {
    allowedChains: [8453],
    allowedPayees: ["0x2222222222222222222222222222222222222222"],
    allowedTokens: [null],
    maxAmount: "10000",
    allowedResources: ["https://api.example.com/reports/123"],
    maxExpiryWindowSec: 300,
    maxSettlementWindowSec: 3600,
  },
  onAccepted: D402PaymentAction.Settle,
  onRejected: D402PaymentAction.RequestRefund,
});

const response = await client.fetch("https://api.example.com/reports/123");
```

## Guardrails

Client policy runs before payment creation. Use it to limit what an unattended
or user-approved signer is allowed to pay for.

```ts
policy: {
  allowedChains: [8453],
  allowedPayees: ["0x2222222222222222222222222222222222222222"],
  allowedTokens: [null],
  maxAmount: "10000",
  allowedResources: [/^https:\/\/api\.example\.com\/reports\/[^/]+$/],
  maxExpiryWindowSec: 300,
  maxSettlementWindowSec: 3600,
  requireAgreementHash: true,
}
```

## What The Client Sends

The client creates a dPayment when it accepts a 402 payment request.
For ERC-20 payments, the executor may send an approval transaction before the
create-payment transaction.

After the paid request returns, `onAccepted` and `onRejected` decide whether the
client keeps the payment open, settles it, disputes it, or requests a refund.

```ts
const client = await createD402Client({
  provider,
  signer,
  onAccepted: D402PaymentAction.Settle,
  onRejected: D402PaymentAction.Dispute,
});
```

## Server Actions

Servers can also send dPayment action transactions with their own signer.

```ts
import { paymentActions } from "@d402/sdk/server";

const actions = paymentActions({
  provider,
  signer,
  actionConfirmations: 2,
});

await actions.settlePayment(paymentAddress);
await actions.refundPayment(paymentAddress);
await actions.submitEvidence(paymentAddress, "ipfs://QmEvidence");
await actions.appealPayment(paymentAddress);
```

The server action signer is separate from the payer signer used by the client.
