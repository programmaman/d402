import {
  D402ConfigurationError,
} from "./errors.js";
import {
  normalizePaymentExecutionError,
} from "../runtime/payment-execution-error.js";
import type {
  D402PaymentExecutionError,
  D402PaymentOperation,
} from "../runtime/payment-execution-error.js";
import { D402PaymentAction } from "./types.js";
import type {
  D402ErrorDecoder,
  D402PaymentActionResult,
} from "../core/index.js";
import type { AbiCodec } from "@rakelabs/dpayments-sdk";
import type {
  D402AcceptedPaymentAction,
  D402CreatedPayment,
  D402PaymentActionResolution,
  D402PaymentAttempt,
  D402PaymentExecutor,
  D402RejectedPaymentAction,
  D402ResponseDecision,
} from "./types.js";

export async function resolvePaymentAfterAcceptance(input: {
  paymentAttempt: D402PaymentAttempt;
  responseDecision: D402ResponseDecision;
  onAccepted: D402AcceptedPaymentAction;
  onRejected: D402RejectedPaymentAction;
  executor: D402PaymentExecutor;
  codec: AbiCodec;
  errorDecoder?: D402ErrorDecoder | undefined;
  requestRefund: (
    payment: D402PaymentAttempt,
    reason?: string,
  ) => Promise<D402PaymentActionResult>;
}): Promise<D402PaymentActionResolution> {
  const payment = input.paymentAttempt.payment;

  if (input.responseDecision.accepted) {
    if (input.onAccepted === D402PaymentAction.KeepOpen) {
      return { action: "kept-open" };
    }

    if (input.executor.settlePayment === undefined) {
      throw new D402ConfigurationError(
        "onAccepted is set to settle, but executor.settlePayment is not configured. Provide an executor with settlePayment or keep the payment open.",
      );
    }

    try {
      const result = await input.executor.settlePayment(payment);
      return { action: "settled", txHash: result.txHash };
    } catch (cause) {
      throw paymentExecutionError(
        "settle",
        payment,
        cause,
        input.codec,
        input.errorDecoder,
      );
    }
  }

  if (input.onRejected === D402PaymentAction.KeepOpen) {
    return { action: "kept-open" };
  }

  if (input.onRejected === D402PaymentAction.RequestRefund) {
    const result = await input.requestRefund(
      input.paymentAttempt,
      input.responseDecision.reason,
    );

    return { action: "refunded", txHash: result.txHash };
  }

  if (input.executor.disputePayment === undefined) {
    throw new D402ConfigurationError(
      "onRejected is set to dispute, but executor.disputePayment is not configured. Provide an executor with disputePayment or keep the payment open.",
    );
  }

  try {
    const result = await input.executor.disputePayment(
      payment,
      input.responseDecision.reason,
    );
    return { action: "disputed", txHash: result.txHash };
  } catch (cause) {
    throw paymentExecutionError(
      "dispute",
      payment,
      cause,
      input.codec,
      input.errorDecoder,
    );
  }
}

function paymentExecutionError(
  operation: D402PaymentOperation,
  payment: D402CreatedPayment,
  cause: unknown,
  codec: AbiCodec,
  errorDecoder?: D402ErrorDecoder,
): D402PaymentExecutionError {
  return normalizePaymentExecutionError({
    operation,
    paymentAddress: payment.paymentAddress,
    codec,
    errorDecoder,
    cause,
  });
}
