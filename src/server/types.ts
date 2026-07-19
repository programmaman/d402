import type {
  DPaymentProof,
  D402BlockReference,
  D402PaymentRequest,
  D402PaymentTerms,
  PaymentAddress,
} from "../core/index.js";
import type { AbstractProvider, Signer } from "ethers";

export type PaymentResourceResolver<Req = Request> =
  | string
  | ((request: Req) => string | Promise<string>);

export interface PaymentConfig<Req = Request> {
  provider: AbstractProvider;
  signer?: Signer;
  resource?: PaymentResourceResolver<Req>;
  confirmations?: number;
  settlementWindow?: number;
  settlementTimeUnixSec?: number;
  cache?: boolean | number;
}

export interface PayableTerms {
  chainId: number;
  payeeAddress: D402PaymentTerms["payeeAddress"];
  tokenAddress: D402PaymentTerms["tokenAddress"];
  netAmount: D402PaymentTerms["netAmount"];
  agreement: D402PaymentTerms["agreement"];
  expiresAtUnixSec: number;
  version?: 1;
  method?: string;
  resource?: string;
  settlementTimeUnixSec?: D402PaymentTerms["settlementTimeUnixSec"];
}

export type PayableTermsResolver<Req = Request> =
  | PayableTerms
  | ((request: Req) => PayableTerms | Promise<PayableTerms>);

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
  | "unsupported-chain"
  | "wrong-chain"
  | "wrong-factory"
  | "wrong-payment-address"
  | "wrong-payee"
  | "wrong-token"
  | "wrong-amount"
  | "wrong-settlement-time"
  | "wrong-payer"
  | "insufficient-confirmations"
  | "failed-transaction"
  | "missing-created-event"
  | "disputed-payment"
  | "resolved-payment"
  | "provider-error";

export type PaymentVerificationFailureReason =
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
  paymentId: D402PaymentRequest["paymentId"];
  paymentAddress: PaymentAddress;
  txHash: DPaymentProof["txHash"];
  payerAddress: DPaymentProof["payerAddress"];
  state: PaymentState;
  confirmations?: number;
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
  settlePayment: (paymentAddress: PaymentAddress) => Promise<PaymentActionResult>;
  refundPayment: (paymentAddress: PaymentAddress) => Promise<PaymentActionResult>;
  submitEvidence: (
    paymentAddress: PaymentAddress,
    evidenceUri: string,
  ) => Promise<PaymentActionResult>;
  appealPayment: (
    paymentAddress: PaymentAddress,
  ) => Promise<PaymentAppealResult>;
}

export type PaymentVerificationResult =
  | { ok: true; payment?: VerifiedPayment }
  | {
      ok: false;
      reason: PaymentVerificationFailureReason;
      message?: string;
      cause?: unknown;
    };

export interface PaymentVerifierInput<Req = Request> {
  request: Req;
  paymentRequest: D402PaymentRequest;
  dPaymentProof: DPaymentProof;
  settlementReference?: D402BlockReference;
}

export type PaymentVerifier<Req = Request> = (
  input: PaymentVerifierInput<Req>,
) => PaymentVerificationResult | Promise<PaymentVerificationResult>;

export interface PayableContext {
  paymentRequest: D402PaymentRequest;
  dPaymentProof: DPaymentProof;
  verification: Extract<PaymentVerificationResult, { ok: true }>;
  payment?: VerifiedPayment;
  settlementReference?: D402BlockReference;
}

export type PayableHandler<Req = Request, Res = Response> = (
  request: Req,
  context: PayableContext,
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
}

export interface PaymentVerificationErrorResponseBody {
  reason: PaymentVerificationErrorReason;
}

export interface PaymentVerificationErrorReason {
  code: PaymentVerificationFailureReason;
  retryable: boolean;
  message?: string;
}

export type PaymentVerificationErrorResponseBuilder = (
  init: PaymentVerificationErrorResponseInit,
) => Response;

export interface PayableRouteConfig<Req = Request, Res = Response> {
  paymentConfig: PaymentConfig<Req>;
  terms: PayableTermsResolver<Req>;
  handler: PayableHandler<Req, Res>;
  verify?: PaymentVerifier<Req>;
  proofHeaderName?: string;
  buildPaymentRequiredResponse?: PaymentRequiredResponseBuilder;
  buildPaymentVerificationErrorResponse?: PaymentVerificationErrorResponseBuilder;
}
