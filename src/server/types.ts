import type {
  Address,
  DPaymentProof,
  D402BlockReference,
  D402PaymentRequest,
  D402PaymentTerms,
  Hex32,
  PaymentAddress,
} from "../core/index.js";
import type { AbstractProvider, Signer } from "ethers";
import type { D402Logger } from "../runtime/logger.js";
import type { PaymentConsumer } from "./payment-consumer.js";

export type PayableTermsResourceResolver =
  | string
  | ((request: Request) => string | Promise<string>);

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

export interface PayableTerms {
  chainId: number;
  payeeAddress: D402PaymentTerms["payeeAddress"];
  tokenAddress: D402PaymentTerms["tokenAddress"];
  netAmount: D402PaymentTerms["netAmount"];
  agreement: D402PaymentTerms["agreement"];
  expiresAtUnixSec: number;
  version?: D402PaymentRequest["version"];
  method?: string;
  resource?: PayableTermsResourceResolver;
  settlementTimeUnixSec?: D402PaymentTerms["settlementTimeUnixSec"];
}

export type PayableTermsResolver =
  | PayableTerms
  | ((request: Request) => PayableTerms | Promise<PayableTerms>);

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

export type PaymentRequiredReasonCode = "missing-proof";

export type PaymentRequiredReasonCategory =
  | "proof"
  | "request"
  | "chain"
  | "policy";

export interface PaymentRequiredReason {
  code: PaymentRequiredReasonCode;
  category: PaymentRequiredReasonCategory;
  retryable: boolean;
  message?: string;
}

export type PaymentState = "funded" | "settled" | "disputed" | "resolved";

export interface VerifiedPayment {
  paymentId: Hex32;
  paymentAddress: PaymentAddress;
  txHash: DPaymentProof["txHash"];
  payerAddress: Address;
  state: PaymentState;
  confirmations?: number;
  creationBlockNumber?: number;
  creationBlockHash?: Hex32;
}

export interface PaymentActionResult {
  txHash: DPaymentProof["txHash"];
}

export interface PaymentAppealPeriod {
  start: bigint;
  end: bigint;
}

export interface PaymentAppealResult extends PaymentActionResult {
  appealFeeWei: bigint;
  appealPeriod: PaymentAppealPeriod;
}

export interface PaymentActions {
  settlePayment: (
    paymentAddress: PaymentAddress,
  ) => Promise<PaymentActionResult>;
  refundPayment: (
    paymentAddress: PaymentAddress,
  ) => Promise<PaymentActionResult>;
  consumePayment: (
    paymentAddress: PaymentAddress,
  ) => Promise<PaymentActionResult>;
  submitEvidence: (
    paymentAddress: PaymentAddress,
    evidenceUri: string,
  ) => Promise<PaymentActionResult>;
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

export interface PaymentRequiredResponseInit {
  paymentRequest: D402PaymentRequest;
  settlementReference?: D402BlockReference;
  reason: PaymentRequiredReason;
}

export interface PaymentRequiredResponseBody {
  paymentRequest: D402PaymentRequest;
  settlementReference?: D402BlockReference;
  reason: PaymentRequiredReason;
}

export type PaymentRequiredResponseBuilder = (
  init: PaymentRequiredResponseInit,
) => Response;

export interface PaymentVerificationErrorResponseInit {
  status: 422 | 425 | 503 | 504;
  reason: PaymentVerificationErrorReason;
  failure: PaymentFailure;
}

export interface PaymentVerificationErrorResponseBody {
  reason: PaymentVerificationErrorReason;
}

export interface PaymentVerificationErrorReason {
  code: PaymentFailureReason;
  retryable: boolean;
  message?: string;
}

export type PaymentVerificationErrorResponseBuilder = (
  init: PaymentVerificationErrorResponseInit,
) => Response;

export interface PayableRouteConfig<Req = Request, Result = void, Res = Response> {
  paymentConfig: PaymentConfig;
  terms: PayableTermsResolver;
  handler: PayableHandler<Req, Result, Res>;
  verifier?: PaymentVerifier;
  recovery?: PaymentRecovery;
  consumer?: PaymentConsumer<Result>;
  proofHeaderName?: string;
  buildPaymentRequiredResponse?: PaymentRequiredResponseBuilder;
  buildPaymentVerificationErrorResponse?: PaymentVerificationErrorResponseBuilder;
}
