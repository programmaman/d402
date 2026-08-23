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
  D402RefundRoute,
} from "../core/index.js";
import { refundsSchema } from "../core/schemas.js";
import type {
  PaymentAuthorizationConfig,
  PaymentAuthorizationOutcome,
  PaymentFailure,
  PaymentRequiredResponseBuilder,
} from "./types.js";
import {
  createDPaymentsAuthenticator,
  createDPaymentsObserver,
  verifyPaymentSalt,
} from "./payment-verifier.js";
import { None, type PaymentConsumer } from "./payment-consumer.js";
import { FundedOrSettledPayment } from "./verification-policy.js";
import { emitLog, NoopLogger } from "../runtime/logger.js";
import type { D402Logger } from "../runtime/logger.js";

export class PaymentAuthorizer<
  Req extends Request = Request,
  Result = void,
> {
  readonly #config: PaymentAuthorizationConfig<Req, Result>;
  readonly #authenticator;
  readonly #observer;
  readonly #verificationPolicy;
  readonly #consumer: PaymentConsumer<Result>;
  readonly #referenceCache;
  readonly #refunds: D402RefundRoute | undefined;
  readonly #logger: D402Logger;

  constructor(config: PaymentAuthorizationConfig<Req, Result>) {
    this.#config = config;
    this.#logger = config.payment.logger ?? NoopLogger;
    this.#authenticator = createDPaymentsAuthenticator(config);
    this.#observer = createDPaymentsObserver(config);
    this.#verificationPolicy = config.verificationPolicy
      ?? FundedOrSettledPayment;
    this.#consumer = config.consumer ?? (None as PaymentConsumer<Result>);
    this.#refunds = config.refunds === undefined
      ? undefined
      : refundsSchema.parse(config.refunds);

    const cacheSetting = config.payment.cache
      ?? (config.payment.settlementWindow !== undefined ? true : undefined);
    const referenceCacheTtlMs = resolveLatestBlockCacheTtlMs(cacheSetting);
    this.#referenceCache = referenceCacheTtlMs === null
      ? null
      : createBlockReferenceCache(referenceCacheTtlMs, 256, this.#logger);
  }

  async authorize(
    request: Req,
  ): Promise<PaymentAuthorizationOutcome<Result>> {
    let proof: D402PaymentProof | undefined;
    try {
      proof = readD402PaymentProofFromRequest(request, this.#config.proofHeaderName);
    } catch {
      return {
        response: buildVerificationFailureResponse(
          this.#config,
          { ok: false, reason: "invalid-proof" },
        ),
      };
    }

    const terms = await resolvePayableTerms(request, this.#config.terms);

    if (proof === undefined) {
      const challengeStartedAt = Date.now();
      emitLog(this.#logger, {
        level: "debug",
        event: "settlement.challenge.started",
        message: "Resolving settlement timing for a payment challenge.",
        context: {
          resource: terms.resource,
          settlementWindow: this.#config.payment.settlementWindow,
          cacheEnabled: this.#referenceCache !== null,
        },
      });
      let challengeSettlement;
      try {
        challengeSettlement = await resolveChallengeSettlementTerms(
          this.#config,
          terms,
          this.#referenceCache,
        );
      } catch (cause) {
        emitLog(this.#logger, {
          level: "error",
          event: "settlement.challenge.failed",
          message: "Failed to resolve settlement timing for a payment challenge.",
          context: {
            resource: terms.resource,
            durationMs: Date.now() - challengeStartedAt,
            error: describeError(cause),
          },
        });
        if (cause instanceof SettlementTimingConfigurationError) {
          throw cause;
        }
        return {
          response: buildVerificationFailureResponse(
            this.#config,
            {
              ok: false,
              reason: isTimeoutError(cause) ? "provider-timeout" : "provider-error",
              cause,
            },
          ),
        };
      }

      emitLog(this.#logger, {
        level: "debug",
        event: "settlement.challenge.succeeded",
        message: "Resolved settlement timing for a payment challenge.",
        context: {
          resource: terms.resource,
          settlementTimeUnixSec: challengeSettlement.terms.settlementTimeUnixSec,
          settlementReference: challengeSettlement.settlementReference,
          durationMs: Date.now() - challengeStartedAt,
        },
      });

      const paymentRequest = buildServerPaymentRequest({
        request,
        terms: challengeSettlement.terms,
        ...(this.#config.payment.identifier !== undefined
          ? { identifier: this.#config.payment.identifier }
          : {}),
      });

      if (
        paymentRequest.expiresAtUnixSec <=
        Math.floor(Date.now() / 1000)
      ) {
        emitLog(this.#logger, {
          level: "error",
          event: "settlement.challenge.expired",
          message: "Refusing to issue a payment challenge whose settlement time has already passed.",
          context: {
            resource: terms.resource,
            expiresAtUnixSec: paymentRequest.expiresAtUnixSec,
            nowUnixSec: Math.floor(Date.now() / 1000),
            settlementReference: challengeSettlement.settlementReference,
          },
        });
        throw new Error(
          "Cannot issue a payment challenge with expired terms.",
        );
      }

      return {
        response: buildChallengeResponse(
          this.#config,
          paymentRequest,
          challengeSettlement.settlementReference,
          this.#refunds,
        ),
      };
    }

    const settlement = resolveProofSettlementTerms(
      this.#config,
      terms,
      proof.settlementReference,
    );
    if (!settlement.ok) {
      return {
        response: buildVerificationFailureResponse(
          this.#config,
          { ok: false, reason: settlement.reason },
        ),
      };
    }

    const paymentRequest = buildServerPaymentRequest({
      request,
      terms: settlement.terms,
      ...(this.#config.payment.identifier !== undefined
        ? { identifier: this.#config.payment.identifier }
        : {}),
    });
    const { dPaymentProof } = proof;

    const saltResult = verifyPaymentSalt(paymentRequest, dPaymentProof);
    if (!saltResult.ok) {
      return {
        response: buildVerificationFailureResponse(this.#config, saltResult),
      };
    }

    let authenticatedSettlementReference: D402BlockReference | undefined;
    if (settlement.mode === "window" && settlement.settlementReference !== undefined) {
      const resolvedReference = await resolveSettlementReference(
        this.#config.adapter.rpcClient,
        this.#referenceCache,
        settlement.settlementReference,
      );
      if (!resolvedReference.ok) {
        return {
          response: buildVerificationFailureResponse(
            this.#config,
            { ok: false, reason: resolvedReference.reason },
          ),
        };
      }
      authenticatedSettlementReference = resolvedReference.reference;
    }

    const authentication = await this.#authenticator({
      request,
      paymentRequest,
      dPaymentProof,
      ...(authenticatedSettlementReference !== undefined
        ? { settlementReference: authenticatedSettlementReference }
        : {}),
    });

    if (!authentication.ok) {
      return {
        response: buildVerificationFailureResponse(this.#config, authentication),
      };
    }

    const authenticated = {
      paymentRequest,
      dPaymentProof,
      payment: authentication.payment,
      ...(authenticatedSettlementReference !== undefined
        ? { settlementReference: authenticatedSettlementReference }
        : {}),
    };

    const recovered = await this.#config.recovery?.(authenticated);
    if (recovered !== undefined) {
      return { response: recovered };
    }

    const observation = await this.#observer(authenticated);
    if (!observation.ok) {
      return {
        response: buildVerificationFailureResponse(this.#config, observation),
      };
    }

    const observed = {
      ...authenticated,
      payment: observation.payment,
    };

    const verification = await this.#verificationPolicy.verify(observed);
    if (!verification.ok) {
      return {
        response: buildVerificationFailureResponse(this.#config, verification),
      };
    }

    const consumption = await this.#consumer.consume(observed);
    if (!consumption.ok) {
      return {
        response: buildVerificationFailureResponse(this.#config, consumption),
      };
    }

    return {
      context: {
        ...observed,
        consumerResult: consumption.result,
      },
    };
  }
}

function describeError(error: unknown): Readonly<Record<string, unknown>> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    };
  }
  return { value: String(error) };
}

function buildChallengeResponse<Req extends Request, Result>(
  config: PaymentAuthorizationConfig<Req, Result>,
  paymentRequest: D402PaymentRequest,
  settlementReference?: D402BlockReference,
  refunds?: D402RefundRoute,
): Response {
  const builder: PaymentRequiredResponseBuilder =
    config.buildPaymentRequiredResponse ?? buildPaymentRequiredResponse;
  return builder({
    paymentRequest,
    ...(settlementReference !== undefined ? { settlementReference } : {}),
    ...(refunds !== undefined ? { refunds } : {}),
    reason: buildPaymentRequiredReason("missing-proof"),
  });
}

function buildVerificationFailureResponse<Req extends Request, Result>(
  config: PaymentAuthorizationConfig<Req, Result>,
  failure: PaymentFailure,
): Response {
  const builder = config.buildPaymentVerificationErrorResponse
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
