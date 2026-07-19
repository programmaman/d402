import canonicalize from "canonicalize";
import { keccak256, toUtf8Bytes } from "ethers";

import { termsHashInputSchema } from "./schemas.js";
import type { D402PaymentTerms, Hex32 } from "./types.js";

export function hashNormalizedPaymentTerms(input: D402PaymentTerms): Hex32 {
  // Challenge expiration controls whether the server should issue a 402;
  // it is not part of the payment identity. Excluding it keeps the payment
  // ID stable when a proof-bearing retry reconstructs terms later.
  const { expiresAtUnixSec, ...paymentIdentity } = input;
  void expiresAtUnixSec;
  const canonical = canonicalize(paymentIdentity);
  if (canonical === undefined) {
    throw new Error("canonicalize returned no output");
  }

  return keccak256(toUtf8Bytes(canonical)) as Hex32;
}

export function hashPaymentTerms(input: unknown): Hex32 {
  const parsed = termsHashInputSchema.parse(input);
  const normalized: D402PaymentTerms = {
    version: parsed.version,
    resource: parsed.resource,
    chainId: parsed.chainId,
    payeeAddress: parsed.payeeAddress,
    tokenAddress: parsed.tokenAddress,
    netAmount: parsed.netAmount,
    settlementTimeUnixSec: parsed.settlementTimeUnixSec,
    agreement: parsed.agreement,
    expiresAtUnixSec: parsed.expiresAtUnixSec,
    ...(parsed.method !== undefined ? { method: parsed.method } : {}),
  };

  return hashNormalizedPaymentTerms(normalized);
}
