# Ethers and Viem adapters

d402 core is provider-neutral. It does not construct Ethers providers,
Viem clients, wallets, transaction requests, receipts, or provider-specific
errors. A provider integration supplies four capabilities:

```ts
rpcClient   // chain reads and normalized receipts
codec       // ABI and event encoding/decoding
errorDecoder // provider error -> decoded contract error
txSender    // transaction preparation, broadcast, retry, and confirmation
```

The official integrations are `@d402/ethers` and `@d402/viem`.

## Install

For Ethers:

```sh
npm install d402 @d402/ethers ethers
```

For Viem:

```sh
npm install d402 @d402/viem viem
```

## Ethers

Create the adapter once and pass its capabilities to the d402 client:

```ts
import { JsonRpcProvider, Wallet } from "ethers";
import { createEthersAdapter } from "@d402/ethers";
import { createD402Client } from "d402/client";

const provider = new JsonRpcProvider(process.env.RPC_URL);
const signer = new Wallet(process.env.PAYER_PRIVATE_KEY, provider);
const adapter = createEthersAdapter({ provider, signer, confirmations: 1 });

const client = await createD402Client({
  ...adapter,
  policy: { allowedChains: [100] },
});
```

For a shorter provider-specific client constructor, use `createEthersClient()`:

```ts
import { createEthersClient } from "@d402/ethers";

const client = await createEthersClient({
  provider,
  signer,
  confirmations: 1,
  policy: { allowedChains: [100] },
});
```

For server actions, use the same adapter capabilities:

```ts
import { JsonRpcProvider, Wallet } from "ethers";
import { createEthersAdapter } from "@d402/ethers";
import { Once, payable, paymentActions } from "d402/server";

const provider = new JsonRpcProvider(process.env.RPC_URL);
const signer = new Wallet(process.env.PAYEE_PRIVATE_KEY, provider);

const adapter = createEthersAdapter({ provider, signer });
const actions = paymentActions({
  adapter,
  payment: { confirmations: 1 },
});

export const route = payable({
  adapter,
  payment: { confirmations: 1, settlementWindow: 3600 },
  terms,
  consumer: Once(actions),
  handler,
});
```

## Viem

Viem applications construct their own public and wallet clients, then pass
them to the adapter:

```ts
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";
import { createViemClient } from "@d402/viem";

const account = privateKeyToAccount(process.env.PAYER_PRIVATE_KEY);
const publicClient = createPublicClient({ chain: mainnet, transport: http() });
const walletClient = createWalletClient({
  account,
  chain: mainnet,
  transport: http(),
});
const client = await createViemClient({
  publicClient,
  walletClient,
  confirmations: 1,
});
```

The low-level `createViemAdapter()` remains available when the same neutral
capabilities must be shared by multiple d402 components.

The same `adapter` object can be placed in the `PaymentConfig` passed to
`paymentActions()` and `payable()` for server-side lifecycle actions. A
read-only adapter omits
`walletClient` and therefore does not expose `txSender`; it is suitable for
verification-only integrations, not for payment creation or server actions.

## Confirmation and error behavior

Client transaction confirmation depth is configured when creating the adapter.
Server verification and action confirmation depth belongs in
`PaymentConfig.payment`. The adapter owns provider-specific nonce, gas,
receipt, confirmation, and retry behavior for the transactions it sends.

Contract errors are decoded by the adapter's `errorDecoder` and normalized by
d402 into `D402PaymentExecutionError`. d402 core does not inspect Ethers or
Viem exception classes.

For custom integrations, implement the same neutral capabilities directly and
pass them to `createD402Client`, or place them in the `adapter` property of the
`PaymentConfig` passed to `paymentActions` or `payable`.
