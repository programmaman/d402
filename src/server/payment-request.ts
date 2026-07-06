import { D402_VERSION } from "../core/constants.js";
import { hashNormalizedPaymentTerms } from "../core/payment-terms-hasher.js";
import { termsHashInputSchema } from "../core/schemas.js";
import type { D402PaymentRequest, D402PaymentTerms } from "../core/types.js";
import type { PayableTerms, PayableTermsResolver } from "./types.js";

export interface BuildServerPaymentRequestInput {
  request: Request;
  terms: PayableTerms;
  resource?: D402PaymentTerms["resource"];
}

export async function resolvePayableTerms<Req>(
  request: Req,
  resolver: PayableTermsResolver<Req>,
): Promise<PayableTerms> {
  return typeof resolver === "function" ? resolver(request) : resolver;
}

export function buildPaymentRequest(input: D402PaymentTerms): D402PaymentRequest {
  const normalizedTerms = normalizePaymentTerms(input);
  const termsHash = hashNormalizedPaymentTerms(normalizedTerms);

  return {
    ...normalizedTerms,
    termsHash,
    paymentId: termsHash,
  };
}

export function buildServerPaymentRequest(
  input: BuildServerPaymentRequestInput,
): D402PaymentRequest {
  return buildPaymentRequest(completeTermsFromRequest(input.request, input.terms, input.resource));
}

function completeTermsFromRequest(
  request: Request,
  terms: PayableTerms,
  resource: D402PaymentTerms["resource"] | undefined,
): D402PaymentTerms {
  const partialTerms = terms as Partial<D402PaymentTerms>;
  const settlementTimeUnixSec = partialTerms.settlementTimeUnixSec;
  const resolvedResource = resource ?? partialTerms.resource;

  if (resolvedResource === undefined) {
    throw new Error(
      "resource must be provided by paymentConfig.resource or terms.resource so the server can build a payment request",
    );
  }

  if (settlementTimeUnixSec === undefined) {
    throw new Error(
      "settlementTimeUnixSec must be provided by paymentConfig.settlementWindow, paymentConfig.settlementTimeUnixSec, or terms.settlementTimeUnixSec",
    );
  }

  return normalizePaymentTerms({
    version: partialTerms.version ?? D402_VERSION,
    resource: resolvedResource,
    method: partialTerms.method ?? request.method,
    chainId: terms.chainId,
    payeeAddress: terms.payeeAddress,
    tokenAddress: terms.tokenAddress,
    netAmount: terms.netAmount,
    settlementTimeUnixSec,
    agreement: terms.agreement,
    expiresAtUnixSec: terms.expiresAtUnixSec,
  });
}

function normalizePaymentTerms(input: D402PaymentTerms): D402PaymentTerms {
  const parsed = termsHashInputSchema.parse(input);

  return {
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
}
