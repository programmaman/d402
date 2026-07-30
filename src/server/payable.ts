import {
  buildPaymentRequiredReason,
  buildPaymentRequiredResponse,
} from "./payment-required.js";
import {
  buildPaymentVerificationErrorReason,
  buildPaymentVerificationErrorResponse,
} from "./payment-verification-error.js";
import { readD402PaymentProofFromRequest } from "./payment-proof.js";
import { buildServerPaymentRequest, resolvePayableTerms } from "./payment-request.js";
import { createBlockReferenceCache, resolveLatestBlockCacheTtlMs } from "./cache.js";
import {
  resolveChallengeSettlementTerms,
  resolveProofSettlementTerms,
  SettlementTimingConfigurationError,
} from "./settlement.js";
import { resolveSettlementReference } from "./settlement-reference.js";
import type {
  D402BlockReference,
  D402PaymentProof,
  D402PaymentRequest,
} from "../core/index.js";
import type {
  PayableRouteConfig,
  PaymentFailure,
  PaymentRequiredResponseBuilder,
} from "./types.js";
import {
  createDPaymentsAuthenticator,
  createDPaymentsVerifier,
  verifyPaymentSalt,
} from "./payment-verifier.js";
import { None } from "./payment-consumer.js";

export function payable<Req extends Request = Request>(
  options: PayableRouteConfig<Req>,
): (request: Req) => Promise<Response> {
  const authenticator = createDPaymentsAuthenticator(options.paymentConfig);
  const verifier = options.verifier ?? createDPaymentsVerifier(options.paymentConfig);
  const consumer = options.consumer ?? None;
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
      return buildVerificationErrorResponse(options, { ok: false, reason: "invalid-proof" });
    }

    const terms = await resolvePayableTerms(request, options.terms);

    if (proof === undefined) {
      let challengeSettlement;
      try {
        challengeSettlement = await resolveChallengeSettlementTerms(
          options.paymentConfig,
          terms,
          referenceCache,
        );
      } catch (cause) {
        if (cause instanceof SettlementTimingConfigurationError) {
          throw cause;
        }
        return buildVerificationErrorResponse(
          options,
          { ok: false, reason: isTimeoutError(cause) ? "provider-timeout" : "provider-error", cause },
        );
      }

      const paymentRequest = buildServerPaymentRequest({
        request,
        terms: challengeSettlement.terms,
        ...(options.paymentConfig.identifier !== undefined
          ? { identifier: options.paymentConfig.identifier }
          : {}),
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
      return buildVerificationErrorResponse(options, { ok: false, reason: settlement.reason });
    }

    const paymentRequest = buildServerPaymentRequest({
      request,
      terms: settlement.terms,
      ...(options.paymentConfig.identifier !== undefined
        ? { identifier: options.paymentConfig.identifier }
        : {}),
    });
    const { dPaymentProof } = proof;

    const saltResult = verifyPaymentSalt(paymentRequest, dPaymentProof);
    if (!saltResult.ok) {
      return buildVerificationErrorResponse(options, saltResult);
    }

    let authenticatedSettlementReference: D402BlockReference | undefined;
    if (settlement.mode === "window" && settlement.settlementReference !== undefined) {
      const resolvedReference = await resolveSettlementReference(
        options.paymentConfig.provider,
        referenceCache,
        settlement.settlementReference,
      );
      if (!resolvedReference.ok) {
        return buildVerificationErrorResponse(options, { ok: false, reason: resolvedReference.reason });
      }
      authenticatedSettlementReference = resolvedReference.reference;
    }

    const authentication = await authenticator({
      request,
      paymentRequest,
      dPaymentProof,
      ...(authenticatedSettlementReference !== undefined
        ? { settlementReference: authenticatedSettlementReference }
        : {}),
    });

    if (!authentication.ok) {
      return buildVerificationErrorResponse(options, authentication);
    }

    const authenticated = {
      paymentRequest,
      dPaymentProof,
      payment: authentication.payment,
      ...(authenticatedSettlementReference !== undefined
        ? { settlementReference: authenticatedSettlementReference }
        : {}),
    };

    const recovered = await options.recovery?.(authenticated);
    if (recovered !== undefined) return recovered;

    const verification = await verifier(authenticated);
    if (!verification.ok) {
      return buildVerificationErrorResponse(options, verification);
    }

    const verified = {
      ...authenticated,
      payment: { ...authenticated.payment, state: verification.state },
    };

    const consumption = await consumer.consume(verified);
    if (!consumption.ok) {
      return buildVerificationErrorResponse(options, consumption);
    }

    return options.handler(request, {
      ...verified,
      consumerResult: consumption.result,
    });
  };
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
  failure: PaymentFailure,
): Response {
  const builder = options.buildPaymentVerificationErrorResponse
    ?? buildPaymentVerificationErrorResponse;
  return builder({
    status: statusForVerificationFailure(failure.reason),
    reason: buildPaymentVerificationErrorReason(failure.reason),
    failure,
  });
}

function statusForVerificationFailure(
  reason: PaymentFailure["reason"],
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
