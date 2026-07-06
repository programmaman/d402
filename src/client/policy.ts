import type { D402PaymentRequest } from "../core/index.js";
import { D402PolicyViolationError } from "./errors.js";
import type { D402ClientPolicy } from "./types.js";

export function validatePaymentPolicy(input: {
  paymentRequest: D402PaymentRequest;
  connectedChainId: number;
  policy: D402ClientPolicy;
}): void {
  const { paymentRequest, connectedChainId, policy } = input;

  if (connectedChainId !== paymentRequest.chainId) {
    throw new D402PolicyViolationError(
      `Connected provider chain ${connectedChainId} does not match payment request chain ${paymentRequest.chainId}.`,
    );
  }

  if (
    policy.allowedChains !== undefined &&
    !policy.allowedChains.includes(paymentRequest.chainId)
  ) {
    throw new D402PolicyViolationError(
      `Payment request chain is not allowed by client policy: ${paymentRequest.chainId}.`,
    );
  }

  if (
    policy.allowedPayees !== undefined &&
    !includesAddress(policy.allowedPayees, paymentRequest.payeeAddress)
  ) {
    throw new D402PolicyViolationError(
      `Payment payee is not allowed by client policy: ${paymentRequest.payeeAddress}.`,
    );
  }

  if (
    policy.allowedTokens !== undefined &&
    !includesToken(policy.allowedTokens, paymentRequest.tokenAddress)
  ) {
    throw new D402PolicyViolationError(
      `Payment token is not allowed by client policy: ${paymentRequest.tokenAddress ?? "null"}.`,
    );
  }

  if (
    policy.allowedResources !== undefined &&
    !matchesAllowedResource(policy.allowedResources, paymentRequest.resource)
  ) {
    throw new D402PolicyViolationError(
      `Payment resource is not allowed by client policy: ${paymentRequest.resource}.`,
    );
  }

  if (
    policy.maxAmount !== undefined &&
    BigInt(paymentRequest.netAmount) > BigInt(policy.maxAmount)
  ) {
    throw new D402PolicyViolationError(
      `Payment amount exceeds client policy: ${paymentRequest.netAmount} > ${policy.maxAmount}.`,
    );
  }

  const now = Math.floor(Date.now() / 1000);
  if (paymentRequest.expiresAtUnixSec <= now) {
    throw new D402PolicyViolationError(
      `Payment request is expired: expiresAtUnixSec=${paymentRequest.expiresAtUnixSec}, now=${now}.`,
    );
  }

  if (
    policy.maxExpiryWindowSec !== undefined &&
    paymentRequest.expiresAtUnixSec > now + policy.maxExpiryWindowSec
  ) {
    throw new D402PolicyViolationError(
      `Payment request expiry is too far in the future: expiresAtUnixSec=${paymentRequest.expiresAtUnixSec}, maxExpiryWindowSec=${policy.maxExpiryWindowSec}.`,
    );
  }

  if (
    policy.maxSettlementWindowSec !== undefined &&
    BigInt(paymentRequest.settlementTimeUnixSec) >
      BigInt(now + policy.maxSettlementWindowSec)
  ) {
    throw new D402PolicyViolationError(
      `Payment settlement window exceeds client policy: settlementTimeUnixSec=${paymentRequest.settlementTimeUnixSec}, maxSettlementWindowSec=${policy.maxSettlementWindowSec}.`,
    );
  }

  if (
    policy.requireAgreementHash === true &&
    paymentRequest.agreement.hash === undefined
  ) {
    throw new D402PolicyViolationError(
      "Payment agreement hash is required by client policy.",
    );
  }
}

function includesAddress(values: string[], address: string): boolean {
  return values.some((value) => value.toLowerCase() === address.toLowerCase());
}

function includesToken(values: Array<string | null>, token: string | null): boolean {
  return values.some((value) => {
    if (value === null || token === null) {
      return value === token;
    }

    return value.toLowerCase() === token.toLowerCase();
  });
}

function matchesAllowedResource(
  allowedResources: Array<string | RegExp>,
  resource: string,
): boolean {
  return allowedResources.some((allowed) => {
    if (typeof allowed === "string") {
      return allowed === resource;
    }

    return allowed.test(resource);
  });
}
