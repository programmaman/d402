# One-Shot Access Example

This example shows how to consume a verified payment on-chain before serving a
download. The server creates `actions = paymentActions({ provider, signer })`
and passes them to `consumer: Once(actions)`. This provides an atomic replay
lock without an application database, Redis lock, sticky session, or shared
cache.

## Setup

```sh
npm install
```

Create `.env`:

```sh
RPC_URL=https://rpc.gnosischain.com
CHAIN_ID=100
PAYEE_ADDRESS=0x2222222222222222222222222222222222222222
PAYEE_PRIVATE_KEY=0x...
PAYER_PRIVATE_KEY=0x...
PORT=3000
```

## Run

```sh
npm run server
npm run client
```

The server uses client identity so each new purchase receives an independent
payment. The first use of a proof succeeds. Reusing that proof is rejected with
`422 payment-already-consumed` before the protected handler runs.

The payee wallet broadcasts the consumption transaction and must have enough
native token for gas. Application storage is still appropriate when the
download or result must be recoverable after a lost HTTP response, but it is
not required for the one-shot replay lock.
