import type {
  Address,
  D402Adapter,
  D402PaymentActionResult,
  D402PaymentChallenge,
  D402RefundRoute,
  DPaymentProof,
  D402BlockReference,
  D402EventHandler,
  D402PaymentRequest,
  Hex32,
  PaymentAddress,
} from "../core/index.js";
import type { MulticallConfig } from "@rakelabs/dpayments-sdk";
import type { D402Logger } from "../runtime/logger.js";
import type { PaymentConsumer } from "./payment-consumer.js";

export interface PayableResolverContext<
  Req extends Request = Request,
> {
  /**
   * The original framework request.
   *
   * Use this for framework-specific metadata. Read request bodies from
   * bodyRequest so the handler's request remains unconsumed.
   */
  readonly originalRequest: Req;
  /**
   * A fresh Request clone dedicated to this resolver.
   */
  readonly bodyRequest: Request;
}

export type PayableTermsResourceResolver<
  Req extends Request = Request,
> =
  | string
  | ((
      request: Request,
      context: Readonly<PayableResolverContext<Req>>,
    ) => string | Promise<string>);

export type PaymentIdentifier =
  | "server"
  | "client";

export interface PaymentOptions {
  confirmations?: number;
  settlementWindow?: number;
  settlementTimeUnixSec?: number;
  cache?: boolean | number;
  identifier?: PaymentIdentifier;
  logger?: D402Logger;
  onEvent?: D402EventHandler;
  /** Trusted private-network or test-chain Multicall3 deployment. */
  multicall?: MulticallConfig;
}

export interface PaymentConfig {
  adapter: D402Adapter;
  payment: PaymentOptions;
}

export type PayableTerms<
  Req extends Request = Request,
> = Pick<
  D402PaymentRequest,
  | "chainId"
  | "payeeAddress"
  | "tokenAddress"
  | "netAmount"
  | "agreement"
  | "expiresAtUnixSec"
> & {
  version?: D402PaymentRequest["version"];
  method?: string;
  resource?: PayableTermsResourceResolver<Req>;
  settlementTimeUnixSec?: D402PaymentRequest["settlementTimeUnixSec"];
};

export type PayableTermsResolver<
  Req extends Request = Request,
> =
  | PayableTerms<Req>
  | ((
      request: Request,
      context: Readonly<PayableResolverContext<Req>>,
    ) => PayableTerms<Req> | Promise<PayableTerms<Req>>);

export type ResolvedPayableTerms = Omit<PayableTerms, "resource"> & {
  resource?: string;
};

export type D402PaymentVerificationFailureReason =
  | "missing-proof"
  | "invalid-proof"
  | "missing-settlement-reference"
  | "reference-block-mismatch"
  | "reference-settlement-out-of-bounds"
  | "reference-provider-error"
  | "provider-timeout"
  | "payment-id-mismatch"
  | "onchain-payment-not-found"
  | "onchain-payment-mismatch"
  | "onchain-payment-not-usable"
  | "payment-not-refundable"
  | "payment-already-consumed"
  | "unsupported-chain"
  | "wrong-chain"
  | "wrong-factory"
  | "wrong-payment-address"
  | "wrong-payee"
  | "wrong-token"
  | "wrong-amount"
  | "wrong-settlement-time"
  | "insufficient-confirmations"
  | "failed-transaction"
  | "missing-created-event"
  | "disputed-payment"
  | "resolved-payment"
  | "provider-error";

export type PaymentFailureReason =
  | D402PaymentVerificationFailureReason
  | (string & {});

export type PaymentState = "funded" | "settled" | "disputed" | "resolved";

export interface PaymentAppealPeriod {
  start: bigint;
  end: bigint;
}

export interface PaymentAppealResult extends D402PaymentActionResult {
  appealFeeWei: bigint;
  appealPeriod: PaymentAppealPeriod;
}

export interface PaymentActions {
  settlePayment: (
    paymentAddress: PaymentAddress,
  ) => Promise<D402PaymentActionResult>;
  refundPayment: (
    paymentAddress: PaymentAddress,
  ) => Promise<D402PaymentActionResult>;
  consumePayment: (
    paymentAddress: PaymentAddress,
  ) => Promise<D402PaymentActionResult>;
  submitEvidence: (
    paymentAddress: PaymentAddress,
    evidenceUri: string,
  ) => Promise<D402PaymentActionResult>;
  appealPayment: (
    paymentAddress: PaymentAddress,
  ) => Promise<PaymentAppealResult>;
}

export interface PaymentFailure {
  ok: false;
  reason: PaymentFailureReason;
  message?: string;
  cause?: unknown;
}

export interface PaymentAuthenticationInput<Req = Request> {
  request: Req;
  paymentRequest: D402PaymentRequest;
  dPaymentProof: DPaymentProof;
  settlementReference?: D402BlockReference;
}

export interface AuthenticatedPayment {
  paymentId: Hex32;
  paymentAddress: PaymentAddress;
  txHash: DPaymentProof["txHash"];
  payerAddress: Address;
  confirmations?: number;
  creationBlockNumber?: number;
  creationBlockHash?: Hex32;
}

export interface ObservedPayment extends AuthenticatedPayment {
  state: PaymentState;
}

export interface AuthenticatedPaymentContext {
  paymentRequest: D402PaymentRequest;
  dPaymentProof: DPaymentProof;
  payment: AuthenticatedPayment;
  settlementReference?: D402BlockReference;
}

export interface ObservedPaymentContext extends Omit<AuthenticatedPaymentContext, "payment"> {
  payment: ObservedPayment;
}

export type PaymentAuthenticator<Req = Request> = (
  input: Readonly<PaymentAuthenticationInput<Req>>,
) => { ok: true; payment: AuthenticatedPayment } | PaymentFailure | Promise<{ ok: true; payment: AuthenticatedPayment } | PaymentFailure>;

export type PaymentObserver = (
  context: Readonly<AuthenticatedPaymentContext>,
) => { ok: true; payment: ObservedPayment } | PaymentFailure | Promise<{ ok: true; payment: ObservedPayment } | PaymentFailure>;

export type VerificationPolicyResult =
  | { ok: true }
  | PaymentFailure;

export interface VerificationPolicy {
  verify(
    context: Readonly<ObservedPaymentContext>,
  ): VerificationPolicyResult | Promise<VerificationPolicyResult>;
}

export interface RefundPolicyContext<
  Req extends Request = Request,
> extends ObservedPaymentContext {
  /** The actual HTTP request received by the refund endpoint. */
  readonly request: Req;
  /** Optional client-provided policy input. */
  readonly reason?: string;
}

export type RefundPolicyResult =
  | { ok: true }
  | PaymentFailure;

export interface RefundPolicy<
  Req extends Request = Request,
> {
  verify(
    context: Readonly<RefundPolicyContext<Req>>,
  ): RefundPolicyResult | Promise<RefundPolicyResult>;
}

export type PaymentRecovery = (
  context: Readonly<AuthenticatedPaymentContext>,
) => Response | undefined | Promise<Response | undefined>;

export interface PayableContext<Result = void> extends ObservedPaymentContext {
  consumerResult: Result;
}

export type PayableHandler<Req = Request, Result = void, Res = Response> = (
  request: Req,
  context: Readonly<PayableContext<Result>>,
) => Res | Promise<Res>;

export type PaymentRequiredResponseBuilder = (
  init: D402PaymentChallenge,
) => Response;

export interface PaymentVerificationErrorBuilderInput {
  status: 422 | 425 | 503 | 504;
  reason: PaymentVerificationErrorReason;
  failure: PaymentFailure;
}

export interface PaymentVerificationErrorReason {
  code: PaymentFailureReason;
  retryable: boolean;
  message?: string;
}

export type PaymentVerificationErrorResponseBuilder = (
  init: PaymentVerificationErrorBuilderInput,
) => Response;

export interface PayableRouteConfig<
  Req extends Request = Request,
  Result = void,
  Res = Response,
> extends PaymentConfig {
  terms: PayableTermsResolver<Req>;
  handler: PayableHandler<Req, Result, Res>;
  verificationPolicy?: VerificationPolicy;
  recovery?: PaymentRecovery;
  consumer?: PaymentConsumer<Result>;
  /**
   * Application-owned canonical refund destination advertised in challenges.
   */
  refunds?: D402RefundRoute;
  proofHeaderName?: string;
  buildPaymentRequiredResponse?: PaymentRequiredResponseBuilder;
  buildPaymentVerificationErrorResponse?: PaymentVerificationErrorResponseBuilder;
}

export type PaymentAuthorizationConfig<
  Req extends Request = Request,
  Result = void,
> = Omit<PayableRouteConfig<Req, Result>, "handler">;

export type PaymentAuthorizationOutcome<Result = void> =
  | {
      response: Response;
      context?: never;
    }
  | {
      response?: never;
      context: Readonly<PayableContext<Result>>;
    };
