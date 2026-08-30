import type { AbiCodec } from "@rakelabs/dpayments-sdk";

import type { D402ErrorDecoder, PaymentAddress } from "../core/index.js";
import { emitLog, NoopLogger } from "./logger.js";
import type { D402Logger } from "./logger.js";

export type D402PaymentOperation =
  | "create"
  | "settle"
  | "refund"
  | "consume"
  | "dispute"
  | "submit-evidence"
  | "appeal";

export interface D402PaymentExecutionErrorInput {
  operation: D402PaymentOperation;
  paymentAddress?: PaymentAddress;
  codec: AbiCodec;
  errorDecoder?: D402ErrorDecoder | undefined;
  logger?: D402Logger | undefined;
  cause: unknown;
}

const operationMessages: Record<D402PaymentOperation, string> = {
  create: "Could not create dPayment.",
  settle: "Could not settle dPayment.",
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
    const logger = input.logger ?? NoopLogger;
    const decoded = input.errorDecoder?.(input.cause);
    emitLog(logger, {
      level: "debug",
      event: "payment.execution.error_decoder.completed",
      message: "Provider error decoder completed.",
      context: {
        decoder: "adapter",
        cause: describeErrorForLog(input.cause),
        decoded: describeErrorForLog(decoded),
        decodedName: decoded?.name,
        returnedUndefined: decoded === undefined,
      },
    });
    const dpaymentsError = decoded?.name;
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

function describeErrorForLog(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== "object") return value;
  if (depth >= 5) return "[truncated]";

  const object = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.getOwnPropertyNames(value)) {
    if (["stack", "request", "requestBody"].includes(key)) continue;
    const property = object[key];
    result[key] = key === "cause" || key === "error"
      ? describeErrorForLog(property, depth + 1)
      : property;
  }
  return result;
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
