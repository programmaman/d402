import type { AbstractProvider } from "ethers";

import type { D402PaymentRequest } from "../core/index.js";
import { D402PolicyViolationError } from "./errors.js";
import type { D402ClientPolicy } from "./types.js";

export async function validatePaymentPolicy(input: {
  paymentRequest: D402PaymentRequest;
  provider: AbstractProvider;
  policy: D402ClientPolicy;
}): Promise<void> {
  const { paymentRequest, provider, policy } = input;
  const network = await provider.getNetwork();

  if (Number(network.chainId) !== paymentRequest.chainId) {
    throw new D402PolicyViolationError(
      "Payment request chain does not match connected provider chain.",
    );
  }

  if (
    policy.allowedChains !== undefined &&
    !policy.allowedChains.includes(paymentRequest.chainId)
  ) {
    throw new D402PolicyViolationError("Payment request chain is not allowed.");
  }

  if (
    policy.allowedPayees !== undefined &&
    !includesAddress(policy.allowedPayees, paymentRequest.payeeAddress)
  ) {
    throw new D402PolicyViolationError("Payment payee is not allowed.");
  }

  if (
    policy.allowedTokens !== undefined &&
    !includesToken(policy.allowedTokens, paymentRequest.tokenAddress)
  ) {
    throw new D402PolicyViolationError("Payment token is not allowed.");
  }

  if (
    policy.allowedResources !== undefined &&
    !matchesAllowedResource(policy.allowedResources, paymentRequest.resource)
  ) {
    throw new D402PolicyViolationError("Payment resource is not allowed.");
  }

  if (
    policy.maxAmount !== undefined &&
    BigInt(paymentRequest.netAmount) > BigInt(policy.maxAmount)
  ) {
    throw new D402PolicyViolationError("Payment amount exceeds client policy.");
  }

  const now = Math.floor(Date.now() / 1000);
  if (paymentRequest.expiresAtUnixSec <= now) {
    throw new D402PolicyViolationError("Payment request is expired.");
  }

  if (
    policy.maxExpiryWindowSec !== undefined &&
    paymentRequest.expiresAtUnixSec > now + policy.maxExpiryWindowSec
  ) {
    throw new D402PolicyViolationError(
      "Payment request expiry is too far in the future.",
    );
  }

  if (
    policy.maxSettlementWindowSec !== undefined &&
    BigInt(paymentRequest.settlementTimeUnixSec) >
      BigInt(now + policy.maxSettlementWindowSec)
  ) {
    throw new D402PolicyViolationError(
      "Payment settlement window exceeds client policy.",
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
