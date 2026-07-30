import { decodeDPaymentError } from "@rakelabs/dpayments-sdk";

import type { PaymentAddress } from "../core/index.js";

export type D402PaymentOperation =
  | "create"
  | "settle"
  | "request-refund"
  | "refund"
  | "consume"
  | "dispute"
  | "submit-evidence"
  | "appeal";

export interface D402PaymentExecutionErrorInput {
  operation: D402PaymentOperation;
  paymentAddress?: PaymentAddress;
  cause: unknown;
}

const operationMessages: Record<D402PaymentOperation, string> = {
  create: "Could not create dPayment.",
  settle: "Could not settle dPayment.",
  "request-refund": "Could not request a dPayment refund.",
  refund: "Could not refund dPayment.",
  consume: "Could not consume dPayment.",
  dispute: "Could not dispute dPayment.",
  "submit-evidence": "Could not submit dPayment evidence.",
  appeal: "Could not appeal dPayment.",
};

export class D402PaymentExecutionError extends Error {
  readonly code = "D402_PAYMENT_EXECUTION_FAILED";
  readonly operation: D402PaymentOperation;
  readonly paymentAddress: PaymentAddress | undefined;
  readonly dpaymentsError: string | undefined;
  readonly transactionError: string | undefined;

  constructor(input: D402PaymentExecutionErrorInput) {
    const decoded = decodeDPaymentError(input.cause);
    const dpaymentsError =
      decoded !== null && "error" in decoded
        ? decoded.error
        : undefined;
    const transactionError = decodeTransactionError(input.cause);
    const baseMessage = operationMessages[input.operation];
    const message = dpaymentsError !== undefined
      ? `${baseMessage} dPayments reverted with ${dpaymentsError}.`
      : transactionError !== undefined
        ? `${baseMessage} Transaction failed with ${transactionError}.`
        : baseMessage;

    super(message, { cause: input.cause });
    this.name = "D402PaymentExecutionError";
    this.operation = input.operation;
    this.paymentAddress = input.paymentAddress;
    this.dpaymentsError = dpaymentsError;
    this.transactionError = transactionError;
  }
}

function decodeTransactionError(cause: unknown): string | undefined {
  if (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    typeof cause.code === "string"
  ) {
    return cause.code;
  }

  return undefined;
}

export function normalizePaymentExecutionError(
  input: D402PaymentExecutionErrorInput,
): D402PaymentExecutionError {
  if (input.cause instanceof D402PaymentExecutionError) {
    return input.cause;
  }

  return new D402PaymentExecutionError(input);
}
