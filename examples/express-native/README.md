# Express Server Integration Examples

The same paid report is exposed through two separate server entry files:

- [`src/payment-authorizer-server.ts`](src/payment-authorizer-server.ts) uses
  `PaymentAuthorizer`. Express owns the successful response and d402 returns
  either a protocol response or the authorized payment context.
- [`src/payable-server.ts`](src/payable-server.ts) uses `payable()`. d402 owns
  authorization and invokes a Fetch-native handler that returns the successful
  response.

Both use [`src/shared.ts`](src/shared.ts) for identical payment terms and the
Express-to-Fetch request and response adapter. This keeps the comparison about
the integration seam rather than different payment behavior.

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

Terminal 1, choose one server:

```sh
npm run server:authorizer
# or
npm run server:payable
```

Terminal 2:

```sh
npm run client
```

The included client requests the report, handles the `402`, creates a
native-token payment, and retries with proof. `npm run server` remains an alias
for the `PaymentAuthorizer` example.
