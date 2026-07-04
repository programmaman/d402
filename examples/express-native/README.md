# Express Native Token Example

This example protects `GET /reports/:id` with d402 and pays for it from a Node
client using a native-token dPayment.

## Setup

```sh
npm install
```

Create `.env`:

```sh
RPC_URL=http://127.0.0.1:8545
CHAIN_ID=1337
PAYEE_ADDRESS=0x2222222222222222222222222222222222222222
PAYER_PRIVATE_KEY=0x...
PORT=3000
```

## Run

Terminal 1:

```sh
npm run server
```

Terminal 2:

```sh
npm run client
```

Before payment, the server returns `402 application/d402+json`. The client then
creates the payment, retries with `D402-Payment-Proof`, and receives the report
JSON.
