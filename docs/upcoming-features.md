# Upcoming Features

## Native facilitation in 0.5.0

Native signed-transaction facilitation is available in 0.5.0. The client (or
another trusted payer service) creates and signs a `PreparedTx`, sends the
opaque `SignedTx` to the server, and `Facilitator` relays it through a
`D402TxBroadcaster`.

The native facilitator:

- accepts one `SignedTx`;
- makes one broadcast attempt;
- returns `D402BroadcastResult`;
- does not sign, construct, inspect, or retry the transaction.

Normal d402 client and server action execution retains the prepared/sign/
broadcast flow and performs bounded nonce-conflict retry by requesting a fresh
signature. Alchemy/ERC-4337 execution and server-created transactions remain
future work and are intentionally outside 0.5.0.

## Future facilitation work

Future work may move payment creation, chain reads, confirmation polling, or
contract lifecycle actions to a server or specialized facilitator. Any such
flow must preserve client-approved terms, auditable payment creation, safe
retry semantics, and independent verification where appropriate.

## Autosigner flows

Add unattended payment flows for agents and services with explicit guardrails:

- allowed resources, payees, tokens, chains, and agreements;
- per-payment and rolling spending limits;
- durable recovery and reuse policy;
- delegated, custodial, remote, or hardware-backed signing;
- auditability and operator controls.

The existing `d402/autosigner` entry point is reserved for this work.
