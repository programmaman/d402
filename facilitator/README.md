# @d402/facilitators

Facilitator implementations for d402.

The package currently provides `NativeFacilitator`, which accepts a client-signed
transaction, submits it through a configured d402 broadcaster, and delegates
canonical payment-proof construction to a proof builder.

```ts
import { NativeFacilitator } from "@d402/facilitators";

const facilitator = new NativeFacilitator({
  broadcaster,
  proofBuilder,
});

const route = payable({
  adapter,
  terms,
  facilitators: { native: facilitator },
  handler,
});
```
