# d402, explained simply

Imagine a report costs one coin.

1. You ask for the report.
2. The server replies, "This report costs one coin."
3. Your client checks the price and creates the matching payment.
4. The client asks again and includes proof.
5. The server confirms the payment and returns the report.

That first reply is HTTP `402 Payment Required`.

## Why the proof is specific

The payment challenge includes the resource, method, chain, payee, token,
amount, timing, and agreement. Those details make the payment belong to one
defined purchase rather than any vaguely similar request.

## Two server shapes

Use `payable()` when d402 can own the complete route:

```ts
const route = payable({
  ...paymentConfig,
  terms,
  handler,
});
```

Use `PaymentAuthorizer` when your controller owns the surrounding work:

```ts
const payment = new PaymentAuthorizer({
  ...paymentConfig,
  terms,
});

const authorization = await payment.authorize(request);

if (authorization.response !== undefined) {
  return authorization.response;
}

return runController(authorization.context);
```

Both use the same payment checks.

## Paying once can mean different things

- A download may use the payment once.
- A subscription may reuse it for months.
- A credit purchase may increase an application balance.
- A deposit may later be settled, refunded, or disputed.

d402 proves the payment. The application decides what the payment buys.

See [Payment flows](docs/schemes.md) for these product shapes and
[Protocol diagrams](docs/protocol.md) for the HTTP exchange.
