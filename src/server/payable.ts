import {
  buildPaymentRequiredReason,
  buildPaymentRequiredResponse,
} from "./payment-required.js";
import { readPaymentProofFromRequest } from "./payment-proof.js";
import { buildServerPaymentRequest, resolvePayableTerms } from "./payment-request.js";
import { createLatestBlockTimestampCache, resolveLatestBlockCacheTtlMs } from "./cache.js";
import { resolveSettlementTerms } from "./settlement.js";
import type {
  PayableRouteConfig,
  PaymentConfig,
  PaymentVerificationFailureReason,
} from "./types.js";
import { createDPaymentsVerifier, verifyPayment } from "./payment-verifier.js";

export function payable<Req extends Request = Request>(
  options: PayableRouteConfig<Req>,
): (request: Req) => Promise<Response> {
  const verifier = options.verify ?? createDPaymentsVerifier(options.paymentConfig);
  const cacheSetting = options.paymentConfig.cache
    ?? (options.paymentConfig.settlementWindow !== undefined ? true : undefined);
  const latestBlockCacheTtlMs = resolveLatestBlockCacheTtlMs(cacheSetting);
  const latestBlockCache =
    latestBlockCacheTtlMs === null
      ? null
      : createLatestBlockTimestampCache(latestBlockCacheTtlMs);

  return async function handlePayableRequest(request: Req): Promise<Response> {
    const terms = await resolvePayableTerms(request, options.terms);
    const resolvedTerms = await resolveSettlementTerms(
      options.paymentConfig,
      terms,
      latestBlockCache,
    );
    const resource = await resolvePaymentResource(request, options.paymentConfig);
    const paymentRequest = buildServerPaymentRequest({
      request,
      terms: resolvedTerms,
      ...(resource !== undefined ? { resource } : {}),
    });
    const proofResult = readPaymentProofFromRequest(request, options.proofHeaderName);

    if (!proofResult.ok) {
      return buildUnpaidResponse(options, paymentRequest, proofResult.reason);
    }

    if (isExpired(paymentRequest.expiresAtUnixSec)) {
      return buildUnpaidResponse(options, paymentRequest, "payment-request-expired");
    }

    const verification = await verifyPayment({
      request,
      paymentRequest,
      proof: proofResult.proof,
      verifier,
    });

    if (!verification.ok) {
      return buildUnpaidResponse(options, paymentRequest, verification.reason);
    }

    return options.handler(request, {
      paymentRequest,
      proof: proofResult.proof,
      verification,
      ...(verification.payment !== undefined ? { payment: verification.payment } : {}),
    });
  };
}

async function resolvePaymentResource<Req extends Request>(
  request: Req,
  paymentConfig: PaymentConfig<Req>,
): Promise<string | undefined> {
  if (paymentConfig.resource === undefined) {
    return undefined;
  }

  return typeof paymentConfig.resource === "function"
    ? paymentConfig.resource(request)
    : paymentConfig.resource;
}

function buildUnpaidResponse<Req extends Request>(
  options: PayableRouteConfig<Req>,
  paymentRequest: Parameters<NonNullable<PayableRouteConfig["buildPaymentRequiredResponse"]>>[0]["paymentRequest"],
  reason: PaymentVerificationFailureReason,
): Response {
  const builder = options.buildPaymentRequiredResponse ?? buildPaymentRequiredResponse;
  return builder({
    paymentRequest,
    reason: buildPaymentRequiredReason(reason),
  });
}

function isExpired(expiresAtUnixSec: number): boolean {
  return expiresAtUnixSec <= Math.floor(Date.now() / 1000);
}
