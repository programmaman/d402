import type { AbstractProvider, Signer } from "ethers";

import type {
  Address,
  D402PaymentProof,
  D402PaymentRequest,
  Hex32,
} from "../core/index.js";
import type { D402Logger } from "../runtime/logger.js";

export interface D402Client {
  /** The executor used by this client for payment creation and payment actions. */
  readonly executor: Readonly<D402PaymentExecutor>;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  d402Fetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<D402FetchResponse>;
  retry(
    payment: D402PaymentAttempt,
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<D402FetchResponse>;
}

/** A completed payment and its proof, suitable for persistence and retry. */
export interface D402PaymentAttempt {
  readonly paymentRequest: D402PaymentRequest;
  readonly payment: D402CreatedPayment;
  readonly proof: D402PaymentProof;
}

/** The HTTP response and, when payment was required, the payment used for it. */
export interface D402FetchResponse {
  readonly response: Response;
  readonly payment?: D402PaymentAttempt;
}

export type D402ClientResourceResolver =
  | string
  | ((request: Request) => string | Promise<string>);

export interface CreateD402ClientOptions {
  signer?: Signer;
  provider?: AbstractProvider;
  fetch?: typeof globalThis.fetch;
  proofHeaderName?: string;
  confirmations?: number;
  policy?: D402ClientPolicy;
  onResponse?: D402ResponseValidator;
  onAccepted?: D402AcceptedPaymentAction;
  onRejected?: D402RejectedPaymentAction;
  executor?: D402PaymentExecutor;
  resource?: D402ClientResourceResolver;
  logger?: D402Logger;
}

export interface D402ClientPolicy {
  maxAmount?: bigint | string;
  allowedChains?: number[];
  allowedPayees?: Address[];
  allowedTokens?: Array<Address | null>;
  allowedResources?: Array<string | RegExp>;
  maxExpiryWindowSec?: number;
  minSettlementWindowSec?: number;
  requireAgreementHash?: boolean;
}

export interface D402CreatedPayment {
  paymentId: Hex32;
  paymentAddress: Address;
  txHash: Hex32;
  paymentSalt: Hex32;
  payerAddress: Address;
}

export interface D402PaymentActionResult {
  txHash: Hex32;
}

export interface D402PaymentExecutor {
  createPayment: (paymentRequest: D402PaymentRequest) => Promise<D402CreatedPayment>;
  settlePayment?: (payment: D402CreatedPayment) => Promise<D402PaymentActionResult>;
  requestRefund?: (
    payment: D402CreatedPayment,
    reason: string,
  ) => Promise<D402PaymentActionResult>;
  disputePayment?: (
    payment: D402CreatedPayment,
    reason: string,
  ) => Promise<D402PaymentActionResult>;
  submitEvidence?: (
    payment: D402CreatedPayment,
    evidenceUri: string,
  ) => Promise<D402PaymentActionResult>;
}

export type D402ResponseDecision =
  | { accepted: true }
  | { accepted: false; reason: string };

export interface D402ResponseValidator {
  validate: (input: {
    paymentRequest: D402PaymentRequest;
    payment: D402CreatedPayment;
    response: Response;
  }) => D402ResponseDecision | Promise<D402ResponseDecision>;
}

export const D402PaymentAction = Object.freeze({
  Settle: "settle",
  RequestRefund: "request-refund",
  Dispute: "dispute",
  KeepOpen: "keep-open",
} as const);

export type D402PaymentActionValue =
  typeof D402PaymentAction[keyof typeof D402PaymentAction];

export type D402AcceptedPaymentAction =
  | typeof D402PaymentAction.Settle
  | typeof D402PaymentAction.KeepOpen;

export type D402RejectedPaymentAction =
  | typeof D402PaymentAction.RequestRefund
  | typeof D402PaymentAction.Dispute
  | typeof D402PaymentAction.KeepOpen;

export interface D402PaymentActionResolution {
  action: "settled" | "refund-requested" | "disputed" | "kept-open";
  txHash?: Hex32;
}
