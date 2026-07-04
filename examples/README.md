# d402 Examples

These examples use the core `payable()` and `createD402Client()` APIs directly.
They intentionally do not use framework adapters.

## Examples

- [express-native](express-native/README.md): Express server plus Node paying client for a native-token payment.
- [next-route-handler](next-route-handler/README.md): Next.js route handler plus server-side paying script.
- [one-shot-access](one-shot-access/README.md): Express route that atomically consumes each verified payment once.

## Requirements

Each example expects:

- Node.js 20+
- an RPC URL for the target chain
- a payer private key with enough funds
- a payee address
- deployed dPayment contracts on the target chain

The current SDK client validates that `paymentRequest.resource` matches the
request URL being retried, so these examples use the request URL as the
resource. Use client policy allowlists to constrain the URL patterns your signer
is allowed to pay for.
