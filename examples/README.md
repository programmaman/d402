# d402 Examples

Three small examples show the common server shapes.

## Examples

- [express-native](express-native/README.md): `PaymentAuthorizer` inside an
  Express controller.
- [next-route-handler](next-route-handler/README.md): `payable()` exported as a
  Next.js route.
- [one-shot-access](one-shot-access/README.md): `payable()` with an on-chain
  single-use claim.

## Requirements

Each example expects:

- Node.js 20+
- an RPC URL for the target chain
- a payer private key with enough funds
- a payee address
- deployed dPayment contracts on the target chain

The examples use the request URL as the payment resource and native-token
payments to keep setup small.
