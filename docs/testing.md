# Testing And Release Checks

d402 has two test layers.

## Unit Tests

Root tests live in `test/` and run with Vitest:

```sh
npm run typecheck
npm test
npm run lint
```

These tests use mocks and fakes for providers, fetch, executors, and the
dPayment SDK. They are fast and precise. They validate hashing, parsing,
client policy, server verification branches, response behavior, and payment
action transaction construction.

## E2E Tests

The e2e suite lives in `e2e_tests/` and is a separate package:

```sh
cd e2e_tests
npm run typecheck
npm test
```

The e2e suite starts real Docker infrastructure:

- a Docker network
- a `cartel-hardhat:test` Hardhat chain
- deployed local dPayment contracts
- a real d402 server container
- real client containers
- real wallets, RPC calls, payment creation, proof generation, and server verification

The main scenarios cover:

- paid GET request through client and server containers
- paid POST replay with body and headers intact
- unpaid request returning d402 terms
- malformed proof rejection
- client resource policy refusal before payment
- client amount policy refusal before payment
- replay guard for pre-existing proof headers

The same file also includes a broader production outcome matrix using in-process
SDK calls with fake provider/executor/verifier helpers. That matrix checks
policy boundaries, verifier reason mapping, action handling, and concurrent
payments without paying the Docker/runtime cost for every case.

## Docker Requirement

The e2e suite requires:

```sh
docker image inspect cartel-hardhat:test
```

If the image is missing, build it from the smartcontracts project before
running e2e tests.

## Windows Development Note

The checked-in `node_modules` in this workspace may contain Linux-native
packages such as `@esbuild/linux-x64`. On Windows hosts, run checks inside a
Linux Node container or reinstall dependencies for Windows. The e2e test
containers themselves expect Linux dependencies.

## Release Gate

Before publishing:

```sh
npm run typecheck
npm test
npm run lint
cd e2e_tests && npm run typecheck && npm test
```

Then run a packaging smoke test:

```sh
npm run build
npm pack
```

Install the generated tarball into a clean temporary project and verify these
imports:

```ts
import "d402";
import "d402/core";
import "d402/client";
import "d402/server";
import "d402/autosigner";
```

Also verify README examples against the current public API before a stable
release.
