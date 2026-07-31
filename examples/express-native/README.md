# Express controller example

This example uses `PaymentAuthorizer` inside an ordinary Express controller.
Express keeps ownership of routing and response handling; d402 returns a
protocol response or the successful payment context.

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

Terminal 1:

```sh
npm run server
```

Terminal 2:

```sh
npm run client
```

The included client requests the report, handles the `402`, creates a
native-token payment, and retries with proof.
