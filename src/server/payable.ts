import {
  buildPaymentRequiredReason,
  buildPaymentRequiredResponse,
} from "./payment-required.js";
import { buildPaymentVerificationErrorResponse } from "./payment-verification-error.js";
import { buildPaymentVerificationErrorReason } from "./payment-verification-error.js";
import { readD402PaymentProofFromRequest } from "./payment-proof.js";
import { buildServerPaymentRequest, resolvePayableTerms } from "./payment-request.js";
import { createBlockReferenceCache, resolveLatestBlockCacheTtlMs } from "./cache.js";
import {
  resolveChallengeSettlementTerms,
  resolveProofSettlementTerms,
  validateSettlementTimingConfiguration,
} from "./settlement.js";
import { resolveSettlementReference } from "./settlement-reference.js";
import type {
  D402BlockReference,
  D402PaymentProof,
  D402PaymentRequest,
} from "../core/index.js";
import type {
  PayableRouteConfig,
  PaymentConfig,
  PaymentRequiredResponseBuilder,
  PaymentVerificationFailureReason,
} from "./types.js";
import { createDPaymentsVerifier, verifyPayment } from "./payment-verifier.js";

export function payable<Req extends Request = Request>(
  options: PayableRouteConfig<Req>,
): (request: Req) => Promise<Response> {
  const verifier = options.verify ?? createDPaymentsVerifier(options.paymentConfig);
  const cacheSetting = options.paymentConfig.cache
    ?? (options.paymentConfig.settlementWindow !== undefined ? true : undefined);
  const referenceCacheTtlMs = resolveLatestBlockCacheTtlMs(cacheSetting);
  const referenceCache = referenceCacheTtlMs === null
    ? null
    : createBlockReferenceCache(referenceCacheTtlMs);

  return async function handlePayableRequest(request: Req): Promise<Response> {
    let proof: D402PaymentProof | undefined;
    try {
      proof = readD402PaymentProofFromRequest(request, options.proofHeaderName);
    } catch {
      return buildVerificationErrorResponse(options, "invalid-proof");
    }

    const [terms, resource] = await Promise.all([
      resolvePayableTerms(request, options.terms),
      resolvePaymentResource(request, options.paymentConfig),
    ]);
    validateSettlementTimingConfiguration(options.paymentConfig, terms);

    if (proof === undefined) {
      let challengeSettlement;
      try {
        challengeSettlement = await resolveChallengeSettlementTerms(
          options.paymentConfig,
          terms,
          referenceCache,
        );
      } catch (cause) {
        return buildVerificationErrorResponse(
          options,
          isTimeoutError(cause) ? "provider-timeout" : "provider-error",
        );
      }

      const paymentRequest = buildServerPaymentRequest({
        request,
        terms: challengeSettlement.terms,
        ...(resource !== undefined ? { resource } : {}),
      });

      if (
        paymentRequest.expiresAtUnixSec <=
        Math.floor(Date.now() / 1000)
      ) {
        throw new Error(
          "Cannot issue a payment challenge with expired terms.",
        );
      }

      return buildChallengeResponse(
        options,
        paymentRequest,
        challengeSettlement.settlementReference,
      );
    }

    const settlement = resolveProofSettlementTerms(
      options.paymentConfig,
      terms,
      proof.settlementReference,
    );
    if (!settlement.ok) {
      return buildVerificationErrorResponse(options, settlement.reason);
    }

    const paymentRequest = buildServerPaymentRequest({
      request,
      terms: settlement.terms,
      ...(resource !== undefined ? { resource } : {}),
    });
    const { dPaymentProof } = proof;

    if (dPaymentProof.paymentId.toLowerCase() !== paymentRequest.paymentId.toLowerCase()) {
      return buildVerificationErrorResponse(options, "payment-id-mismatch");
    }

    let authenticatedSettlementReference: D402BlockReference | undefined;
    if (settlement.mode === "window" && settlement.settlementReference !== undefined) {
      const resolvedReference = await resolveSettlementReference(
        options.paymentConfig.provider,
        referenceCache,
        settlement.settlementReference,
      );
      if (!resolvedReference.ok) {
        return buildVerificationErrorResponse(options, resolvedReference.reason);
      }
      if (resolvedReference.resolution === "verified") {
        authenticatedSettlementReference = settlement.settlementReference;
      }
    }

    const verification = await verifyPayment({
      request,
      paymentRequest,
      dPaymentProof,
      ...(settlement.settlementReference !== undefined
        ? { settlementReference: settlement.settlementReference }
        : {}),
      verifier,
    });

    if (!verification.ok) {
      return buildVerificationErrorResponse(options, verification.reason);
    }

    return options.handler(request, {
      paymentRequest,
      dPaymentProof,
      verification,
      ...(verification.payment !== undefined ? { payment: verification.payment } : {}),
      ...(authenticatedSettlementReference !== undefined
        ? { settlementReference: authenticatedSettlementReference }
        : {}),
    });
  };
}

async function resolvePaymentResource<Req extends Request>(
  request: Req,
  paymentConfig: PaymentConfig<Req>,
): Promise<string | undefined> {
  if (paymentConfig.resource === undefined) return request.url;
  return typeof paymentConfig.resource === "function"
    ? paymentConfig.resource(request)
    : paymentConfig.resource;
}

function buildChallengeResponse<Req extends Request>(
  options: PayableRouteConfig<Req>,
  paymentRequest: D402PaymentRequest,
  settlementReference?: D402BlockReference,
): Response {
  const builder: PaymentRequiredResponseBuilder =
    options.buildPaymentRequiredResponse ?? buildPaymentRequiredResponse;
  return builder({
    paymentRequest,
    ...(settlementReference !== undefined ? { settlementReference } : {}),
    reason: buildPaymentRequiredReason("missing-proof"),
  });
}

function buildVerificationErrorResponse<Req extends Request>(
  options: PayableRouteConfig<Req>,
  reason: PaymentVerificationFailureReason,
): Response {
  const builder = options.buildPaymentVerificationErrorResponse
    ?? buildPaymentVerificationErrorResponse;
  return builder({
    status: statusForVerificationFailure(reason),
    reason: buildPaymentVerificationErrorReason(reason),
  });
}

function statusForVerificationFailure(
  reason: PaymentVerificationFailureReason,
): 422 | 425 | 503 | 504 {
  if (reason === "onchain-payment-not-found" || reason === "insufficient-confirmations") {
    return 425;
  }
  if (reason === "provider-timeout") return 504;
  if (reason === "provider-error" || reason === "reference-provider-error") return 503;
  return 422;
}

function isTimeoutError(cause: unknown): boolean {
  if (!(cause instanceof Error)) return false;
  const candidate = cause as Error & { code?: unknown };
  return candidate.code === "TIMEOUT"
    || candidate.code === "ETIMEDOUT"
    || /timeout/i.test(candidate.message);
}
