import {
  buildPaymentRequiredReason,
  buildPaymentRequiredResponse,
} from "./payment-required.js";
import {
  buildPaymentVerificationErrorReason,
  buildPaymentVerificationErrorResponse,
  statusForPaymentFailure,
} from "./payment-verification-error.js";
import { readD402PaymentProofFromRequest } from "./payment-proof.js";
import { buildServerPaymentRequest, resolvePayableTerms } from "./payment-request.js";
import { createBlockReferenceCache, resolveLatestBlockCacheTtlMs } from "./cache.js";
import {
  resolveChallengeSettlementTerms,
  resolveProofSettlementTerms,
  SettlementTimingConfigurationError,
} from "./settlement.js";
import type { ProofSettlementResult } from "./settlement.js";
import { resolveSettlementReference } from "./settlement-reference.js";
import type {
  D402BlockReference,
  D402FacilitatorAdvertisements,
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
  ResolvedPayableTerms,
} from "./types.js";
import {
  createDPaymentsAuthenticator,
  createDPaymentsObserver,
  verifyPaymentSalt,
} from "./payment-verifier.js";
import { None, type PaymentConsumer } from "./payment-consumer.js";
import { FundedOrSettledPayment } from "./verification-policy.js";
import {
  describeError,
  emitLog,
  NoopLogger,
} from "../runtime/logger.js";
import type { D402Logger } from "../runtime/logger.js";

type ResolvedPaymentProofSettlement = Extract<
  ProofSettlementResult,
  { ok: true }
>;

interface ResolvedPaymentProofContext<
  Req extends Request,
> {
  request: Req;
  paymentRequest: D402PaymentRequest;
  proof: D402PaymentProof;
  settlement: ResolvedPaymentProofSettlement;
}

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
        response: this.#buildPaymentFailureResponse({
          ok: false,
          reason: "invalid-proof",
        }),
      };
    }

    const terms = await resolvePayableTerms(request, this.#config.terms);

    if (proof === undefined) {
      return {
        response: await this.#buildPaymentChallenge(request, terms),
      };
    }

    const resolved = this.#resolvePaymentProof(request, terms, proof);
    if (!resolved.ok) {
      return {
        response: this.#buildPaymentFailureResponse(resolved),
      };
    }

    return this.#authenticatePaymentProof(resolved.value);
  }

  async #authenticatePaymentProof(
    input: ResolvedPaymentProofContext<Req>,
  ): Promise<PaymentAuthorizationOutcome<Result>> {
    const {
      request,
      paymentRequest,
      proof,
      settlement,
    } = input;
    const { dPaymentProof } = proof;

    const saltResult = verifyPaymentSalt(paymentRequest, dPaymentProof);
    if (!saltResult.ok) {
      return {
        response: this.#buildPaymentFailureResponse(saltResult),
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
          response: this.#buildPaymentFailureResponse({
            ok: false,
            reason: resolvedReference.reason,
          }),
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
        response: this.#buildPaymentFailureResponse(authentication),
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
        response: this.#buildPaymentFailureResponse(observation),
      };
    }

    const observed = {
      ...authenticated,
      payment: observation.payment,
    };

    const verification = await this.#verificationPolicy.verify(observed);
    if (!verification.ok) {
      return {
        response: this.#buildPaymentFailureResponse(verification),
      };
    }

    const consumption = await this.#consumer.consume(observed);
    if (!consumption.ok) {
      return {
        response: this.#buildPaymentFailureResponse(consumption),
      };
    }

    return {
      context: {
        ...observed,
        consumerResult: consumption.result,
      },
    };
  }

  #resolvePaymentProof(
    request: Req,
    terms: ResolvedPayableTerms,
    proof: D402PaymentProof,
  ):
    | {
        ok: true;
        value: ResolvedPaymentProofContext<Req>;
      }
    | PaymentFailure {
    const settlement = resolveProofSettlementTerms(
      this.#config,
      terms,
      proof.settlementReference,
    );

    if (!settlement.ok) {
      return settlement;
    }

    const paymentRequest = buildServerPaymentRequest({
      request,
      terms: settlement.terms,
      ...(this.#config.payment.identifier !== undefined
        ? { identifier: this.#config.payment.identifier }
        : {}),
    });

    return {
      ok: true,
      value: {
        request,
        paymentRequest,
        proof,
        settlement,
      },
    };
  }

  async #buildPaymentChallenge(
    request: Req,
    terms: ResolvedPayableTerms,
  ): Promise<Response> {
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
      return this.#buildPaymentFailureResponse(
        {
          ok: false,
          reason: isTimeoutError(cause) ? "provider-timeout" : "provider-error",
          cause,
        },
      );
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

    const facilitation = this.#buildFacilitatorAdvertisements(
      paymentRequest,
    );

    return buildPaymentChallengeResponse(
      this.#config,
      paymentRequest,
      challengeSettlement.settlementReference,
      this.#refunds,
      facilitation,
    );
  }

  #buildFacilitatorAdvertisements(
    payment: D402PaymentRequest,
  ): D402FacilitatorAdvertisements | undefined {
    const facilitators = this.#config.facilitators;

    if (
      facilitators === undefined
      || Object.keys(facilitators).length === 0
    ) {
      return undefined;
    }

    return Object.fromEntries(
      Object.entries(facilitators).map(([name, facilitator]) => [
        name,
        facilitator.advertise(payment),
      ]),
    );
  }

  #buildPaymentFailureResponse(
    failure: PaymentFailure,
  ): Response {
    const builder =
      this.#config
        .buildPaymentVerificationErrorResponse
        ?? buildPaymentVerificationErrorResponse;

    return builder({
      status: statusForPaymentFailure(
        failure.reason,
      ),
      reason: buildPaymentVerificationErrorReason(
        failure.reason,
      ),
      failure,
    });
  }
}

function buildPaymentChallengeResponse<Req extends Request, Result>(
  config: PaymentAuthorizationConfig<Req, Result>,
  paymentRequest: D402PaymentRequest,
  settlementReference?: D402BlockReference,
  refunds?: D402RefundRoute,
  facilitation?: D402FacilitatorAdvertisements,
): Response {
  const builder: PaymentRequiredResponseBuilder =
    config.buildPaymentRequiredResponse ?? buildPaymentRequiredResponse;
  return builder({
    paymentRequest,
    ...(settlementReference !== undefined ? { settlementReference } : {}),
    ...(refunds !== undefined ? { refunds } : {}),
    ...(facilitation !== undefined ? { facilitation } : {}),
    reason: buildPaymentRequiredReason("missing-proof"),
  });
}

function isTimeoutError(cause: unknown): boolean {
  if (!(cause instanceof Error)) return false;
  const candidate = cause as Error & { code?: unknown };
  return candidate.code === "TIMEOUT"
    || candidate.code === "ETIMEDOUT"
    || /timeout/i.test(candidate.message);
}
