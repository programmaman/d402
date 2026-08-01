# Upcoming Features

## Facilitation

Move payment execution and chain interaction to the server.

Clients should not need:

- an RPC provider;
- blockchain state reads;
- transaction confirmation polling;
- chain-specific payment logic.

The server or facilitator would create, observe, settle, and recover payments,
then return the proof needed for the protected request. This should make edge
clients lighter, reduce latency and RPC traffic, centralize payment recovery,
and give the server a more canonical view of payment state.

The design must preserve client-approved terms, auditable payment creation,
safe retry semantics, and independent verification where appropriate.

## Autosigner flows

Add unattended payment flows for agents and services with explicit guardrails:

- allowed resources, payees, tokens, chains, and agreements;
- per-payment and rolling spending limits;
- durable recovery and reuse policy;
- delegated, custodial, remote, or hardware-backed signing;
- auditability and operator controls.

The existing `d402/autosigner` entry point is reserved for this work.
