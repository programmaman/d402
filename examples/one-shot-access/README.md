# One-Shot Access Example

This example shows how to consume a verified payment once. It uses an in-memory
store so the behavior is easy to see; production code should use an atomic
database insert or compare-and-set operation.

## Setup

```sh
npm install
```

Create `.env`:

```sh
RPC_URL=https://rpc.gnosischain.com
CHAIN_ID=100
PAYEE_ADDRESS=0x2222222222222222222222222222222222222222
PAYER_PRIVATE_KEY=0x...
PORT=3000
```

## Run

```sh
npm run server
npm run client
```

The first paid request succeeds. Reusing the same proof would be rejected by the
server-side consumption check.
