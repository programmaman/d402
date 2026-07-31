# One-Shot Access Example

This example uses `Once(actions)` before serving a download. The first use of a
payment succeeds; later uses of the same payment are rejected.

## Setup

```sh
npm install
```

Create `.env`:

```sh
RPC_URL=https://rpc.gnosischain.com
CHAIN_ID=100
PAYEE_PRIVATE_KEY=0x...
PAYER_PRIVATE_KEY=0x...
PORT=3000
```

## Run

```sh
npm run server
npm run client
```

The server uses client identity so every new purchase is independent. The payee
wallet needs native token for the consumption transaction. Store completed
results when delivery must be recoverable after a crash or lost response.
