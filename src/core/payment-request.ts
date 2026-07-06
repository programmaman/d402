import { paymentRequestSchema } from "./schemas.js";
import { hashNormalizedPaymentTerms } from "./payment-terms-hasher.js";
import type { D402PaymentRequest, D402PaymentTerms } from "./types.js";

export function parsePaymentRequest(request: unknown): D402PaymentRequest {
  const parsed = paymentRequestSchema.parse(request);
  const parsedTerms: D402PaymentTerms = {
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
  const computedTermsHash = hashNormalizedPaymentTerms(parsedTerms);

  if (parsed.termsHash !== computedTermsHash) {
    throw new Error(`termsHash mismatch: got ${parsed.termsHash}`);
  }
  if (parsed.paymentId !== computedTermsHash) {
    throw new Error(`paymentId must equal termsHash: got ${parsed.paymentId}`);
  }

  return {
    ...parsedTerms,
    termsHash: parsed.termsHash,
    paymentId: parsed.paymentId,
  };
}
