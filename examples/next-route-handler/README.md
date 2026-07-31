# Next.js Route Handler Example

This example exports a `payable()` route directly from a Next.js route handler.

## Files

- `app/api/reports/[id]/route.ts`: protected route
- `scripts/pay-report.ts`: server-side paying client

## Environment

```sh
RPC_URL=https://rpc.gnosischain.com
CHAIN_ID=100
PAYEE_ADDRESS=0x2222222222222222222222222222222222222222
PAYER_PRIVATE_KEY=0x...
NEXT_PUBLIC_BASE_URL=http://localhost:3000
```

## Run

```sh
npm install
npm run dev
npm run pay-report
```
