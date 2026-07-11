# Changelog

All notable public changes to d402 are documented here.

## Unreleased

### Payment reliability

- Normalized the default client payment and server verification threshold to
  three block confirmations.
- Applications that omit `paymentConfig.minConfirmations` may now receive a
  temporary `402` response until the payment reaches three confirmations.

## 0.1.3

Released in the `0.1.3` release commit.

### Documentation

- Clarified the d402 documentation and public usage guidance.
- Updated README and package documentation to better describe the SDK.

### Maintenance

- Refined the package documentation following the `0.1.2` release.
- Kept the npm package lockfile and published package metadata aligned.

## 0.1.2

Released in the `0.1.2` release commit.

### API and architecture

- Simplified d402's public API and internal structure.
- Continued consolidating the SDK around the d402 payment flow.

### Publishing

- Added the repository URL to package metadata for npm publishing.
- Corrected package-lock synchronization for release publishing.

## 0.1.1

Released in the `0.1.1` release commit.

### Added

- Established the d402 package and HTTP 402 payment protocol implementation.
- Added client-side payment creation and signing flows.
- Added server-side payment verification and payment action support.
- Added support for the dPayments SDK and supported-chain configuration.
- Added CI and Apache 2.0 licensing.

### Payment reliability

- Adopted Quick Disputable Payments for the payment flow.
- Added signing guidance intended to prevent race conditions around ERC20
  transactions.

### Documentation

- Updated the project name and public README content to d402.
- Documented supported chains and native dPayment integration.
