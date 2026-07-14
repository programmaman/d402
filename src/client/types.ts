import type { AbstractProvider, Signer } from "ethers";

import type { Address, D402PaymentRequest, Hex32 } from "../core/index.js";

export interface D402Client {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface CreateD402ClientOptions {
  signer?: Signer;
  provider?: AbstractProvider;
  fetch?: typeof globalThis.fetch;
  proofHeaderName?: string;
  paymentConfirmations?: number;
  actionConfirmations?: number;
  policy?: D402ClientPolicy;
  onResponse?: D402ResponseValidator;
  onAccepted?: D402AcceptedPaymentAction;
  onRejected?: D402RejectedPaymentAction;
  executor?: D402PaymentExecutor;
}

export interface D402ClientPolicy {
  maxAmount?: bigint | string;
  allowedChains?: number[];
  allowedPayees?: Address[];
  allowedTokens?: Array<Address | null>;
  allowedResources?: Array<string | RegExp>;
  maxExpiryWindowSec?: number;
  maxSettlementWindowSec?: number;
  requireAgreementHash?: boolean;
}

export interface D402CreatedPayment {
  paymentId: Hex32;
  paymentAddress: Address;
  txHash: Hex32;
  payerAddress?: Address;
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

export const D402DefaultResponseValidator: D402ResponseValidator = {
  validate({ response }) {
    if (response.ok) {
      return { accepted: true };
    }

    return {
      accepted: false,
      reason: `HTTP ${response.status}`,
    };
  },
};

export const D402PaymentAction = {
  Settle: "settle",
  RequestRefund: "request-refund",
  Dispute: "dispute",
  KeepOpen: "keep-open",
} as const;

export type D402PaymentActionValue =
  typeof D402PaymentAction[keyof typeof D402PaymentAction];

export type D402AcceptedPaymentAction =
  | typeof D402PaymentAction.Settle
  | typeof D402PaymentAction.KeepOpen;

export type D402RejectedPaymentAction =
  | typeof D402PaymentAction.RequestRefund
  | typeof D402PaymentAction.Dispute
  | typeof D402PaymentAction.KeepOpen;

export const D402DefaultPaymentActions = {
  OnAccepted: D402PaymentAction.KeepOpen,
  OnRejected: D402PaymentAction.KeepOpen,
} as const satisfies {
  OnAccepted: D402AcceptedPaymentAction;
  OnRejected: D402RejectedPaymentAction;
};

export interface D402PaymentActionResolution {
  action: "settled" | "refund-requested" | "disputed" | "kept-open";
  txHash?: Hex32;
}
