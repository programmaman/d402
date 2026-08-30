# Ethers and Viem adapters

d402 core is provider-neutral. It does not construct Ethers providers,
Viem clients, wallets, transaction requests, receipts, or provider-specific
errors. A provider integration supplies five capabilities:

```ts
rpcClient   // chain reads and normalized receipts
codec       // ABI and event encoding/decoding
errorDecoder // provider error -> decoded contract error
signer      // payer address lookup and transaction signing
broadcaster // signed transaction broadcast and receipt waiting
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
read-only adapter omits `walletClient` and therefore does not expose `signer`;
it is suitable for verification-only integrations, not for payment creation or
server actions. Its `broadcaster` can still relay an already-signed
transaction through native facilitation.

## Confirmation and error behavior

The transaction boundary is:

```text
PreparedTx
  -> signer.signTx()
  -> SignedTx
  -> broadcaster.broadcastTx()
  -> D402BroadcastResult
```

`signer` handles payer identity, transaction preparation, and signing.
`broadcaster` handles one raw submission attempt and receipt waiting. Its
result is either a pending `D402BroadcastedTx` submission or a structured
failure. Server verification and action confirmation depth belongs in
`PaymentConfig.payment`.

For ordinary client and server action execution, d402 runtime code owns
nonce-conflict retry. It requests a fresh signature before each retry; an
adapter never retries or re-broadcasts the same `SignedTx`. A facilitator
relays a supplied `SignedTx` once and returns the broadcaster result directly.

Contract errors are decoded by the adapter's `errorDecoder` and normalized by
d402 into `D402PaymentExecutionError`. d402 core does not inspect Ethers or
Viem exception classes.

For custom integrations, implement the same neutral capabilities directly and
pass `signer` and `broadcaster` to `createD402Client`, or place them in the
`adapter` property of the `PaymentConfig` passed to `paymentActions` or
`payable`.

## Native facilitation

The client can sign a prepared transaction and send the opaque serialized
transaction to a server. The server only needs a broadcaster. Keep the
provider-specific wallet signer and the provider-neutral d402 signer distinct:

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

if (!result.ok) {
  console.error(result.reason, result.retryable);
}
```

Handle `result.ok === false` according to its `retryable` flag. The facilitator
does not retry a failed submission because it cannot create a new signature.
