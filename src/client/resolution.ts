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
  D402AcceptedPaymentAction,
  D402CreatedPayment,
  D402PaymentActionResolution,
  D402PaymentExecutor,
  D402RejectedPaymentAction,
  D402ResponseDecision,
} from "./types.js";

export async function resolvePaymentAfterAcceptance(input: {
  payment: D402CreatedPayment;
  responseDecision: D402ResponseDecision;
  onAccepted: D402AcceptedPaymentAction;
  onRejected: D402RejectedPaymentAction;
  executor: D402PaymentExecutor;
}): Promise<D402PaymentActionResolution> {
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
      const result = await input.executor.settlePayment(input.payment);
      return { action: "settled", txHash: result.txHash };
    } catch (cause) {
      throw paymentExecutionError("settle", input.payment, cause);
    }
  }

  if (input.onRejected === D402PaymentAction.KeepOpen) {
    return { action: "kept-open" };
  }

  if (input.onRejected === D402PaymentAction.RequestRefund) {
    if (input.executor.requestRefund === undefined) {
      throw new D402ConfigurationError(
        "onRejected is set to request-refund, but executor.requestRefund is not configured. Provide an executor with requestRefund or keep the payment open.",
      );
    }

    try {
      const result = await input.executor.requestRefund(
        input.payment,
        input.responseDecision.reason,
      );
      return { action: "refund-requested", txHash: result.txHash };
    } catch (cause) {
      throw paymentExecutionError("request-refund", input.payment, cause);
    }
  }

  if (input.executor.disputePayment === undefined) {
    throw new D402ConfigurationError(
      "onRejected is set to dispute, but executor.disputePayment is not configured. Provide an executor with disputePayment or keep the payment open.",
    );
  }

  try {
    const result = await input.executor.disputePayment(
      input.payment,
      input.responseDecision.reason,
    );
    return { action: "disputed", txHash: result.txHash };
  } catch (cause) {
    throw paymentExecutionError("dispute", input.payment, cause);
  }
}

function paymentExecutionError(
  operation: D402PaymentOperation,
  payment: D402CreatedPayment,
  cause: unknown,
): D402PaymentExecutionError {
  return normalizePaymentExecutionError({
    operation,
    paymentAddress: payment.paymentAddress,
    cause,
  });
}
