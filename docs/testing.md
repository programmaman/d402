# Testing d402

This guide covers the checks available from a public clone of d402. The
maintainer test suite is not distributed with the repository or npm package,
so public validation uses the compiler, linter, package build, shipped
examples, and public exports.

## Requirements

- Node.js 24
- npm

Install the exact dependency versions from the lockfile:

```sh
npm ci
```

## Validate a Clone

Run the same public checks used by CI:

```sh
npm run typecheck
npm run lint
npm run build
npm run pack:check
```

These commands verify that:

- the TypeScript source typechecks;
- the public source passes ESLint;
- all JavaScript, declaration files, and source maps build into `dist/`;
- the npm package can be assembled with the expected published files.

## Smoke-Test Public Exports

Build the package, then confirm every documented entry point loads:

```sh
npm run build
node --input-type=module -e "await Promise.all(['d402','d402/core','d402/client','d402/server','d402/autosigner'].map((name) => import(name))); console.log('d402 exports loaded')"
```

This catches missing build output and broken package export mappings.

## Check an Example

The projects under `examples/` exercise the public package API. Install and
typecheck the example you are working with:

```sh
npm --prefix examples/express-native install
npm --prefix examples/express-native run typecheck
```

The same pattern works for:

- `examples/next-route-handler`
- `examples/one-shot-access`

Running an example against a chain also requires the RPC URL, funded payer,
payee address, and other environment values described in that example's
README.

## Reporting a Failure

When reporting a problem, include:

- the failing command and complete error;
- the d402 package or commit version;
- `node --version` and `npm --version`;
- the operating system;
- the chain ID and provider type for runtime failures;
- a minimal reproduction using a documented public entry point.