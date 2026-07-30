import type {
  Address,
  D402PaymentActionResult,
  D402PaymentChallenge,
  DPaymentProof,
  D402BlockReference,
  D402PaymentRequest,
  Hex32,
  PaymentAddress,
} from "../core/index.js";
import type { AbstractProvider, Signer } from "ethers";
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

export interface PaymentConfig {
  provider: AbstractProvider;
  signer?: Signer;
  confirmations?: number;
  settlementWindow?: number;
  settlementTimeUnixSec?: number;
  cache?: boolean | number;
  identifier?: PaymentIdentifier;
  logger?: D402Logger;
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

export interface VerifiedPayment extends AuthenticatedPayment {
  state: PaymentState;
}

export interface AuthenticatedPaymentContext {
  paymentRequest: D402PaymentRequest;
  dPaymentProof: DPaymentProof;
  payment: AuthenticatedPayment;
  settlementReference?: D402BlockReference;
}

export interface VerifiedPaymentContext extends Omit<AuthenticatedPaymentContext, "payment"> {
  payment: VerifiedPayment;
}

export type PaymentAuthenticator<Req = Request> = (
  input: Readonly<PaymentAuthenticationInput<Req>>,
) => { ok: true; payment: AuthenticatedPayment } | PaymentFailure | Promise<{ ok: true; payment: AuthenticatedPayment } | PaymentFailure>;

export type PaymentVerifier = (
  context: Readonly<AuthenticatedPaymentContext>,
) => { ok: true; state: PaymentState } | PaymentFailure | Promise<{ ok: true; state: PaymentState } | PaymentFailure>;

export type PaymentRecovery = (
  context: Readonly<AuthenticatedPaymentContext>,
) => Response | undefined | Promise<Response | undefined>;

export interface PayableContext<Result = void> extends VerifiedPaymentContext {
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
> {
  paymentConfig: PaymentConfig;
  terms: PayableTermsResolver<Req>;
  handler: PayableHandler<Req, Result, Res>;
  verifier?: PaymentVerifier;
  recovery?: PaymentRecovery;
  consumer?: PaymentConsumer<Result>;
  proofHeaderName?: string;
  buildPaymentRequiredResponse?: PaymentRequiredResponseBuilder;
  buildPaymentVerificationErrorResponse?: PaymentVerificationErrorResponseBuilder;
}
