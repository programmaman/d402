import { D402_PAYMENT_REQUEST_CONTENT_TYPE } from "../core/index.js";
import type {
  PaymentVerificationErrorBuilderInput,
  PaymentVerificationErrorReason,
  PaymentFailureReason,
} from "./types.js";

export function buildPaymentVerificationErrorReason(
  code: PaymentFailureReason,
): PaymentVerificationErrorReason {
  switch (code) {
    case "invalid-proof":
      return { code, retryable: false, message: "Payment proof could not be parsed or validated." };
    case "invalid-authorization":
      return { code, retryable: false, message: "Payment authorization could not be parsed or validated." };
    case "ambiguous-payment-authorization":
      return { code, retryable: false, message: "Submit either payment proof or payment authorization, not both." };
    case "unsupported-facilitator":
      return { code, retryable: false, message: "The requested payment facilitator is not supported by this route." };
    case "facilitator-error":
      return { code, retryable: true, message: "The payment facilitator could not complete the payment. Retry the request." };
    case "missing-settlement-reference":
      return { code, retryable: false, message: "Window-settlement payment proof is missing its settlement reference." };
    case "reference-block-mismatch":
    case "reference-settlement-out-of-bounds":
      return { code, retryable: false, message: "Settlement reference does not match the payment terms or creation bounds." };
    case "reference-provider-error":
      return { code, retryable: true, message: "Settlement reference verification is temporarily unavailable. Retry with the same proof." };
    case "payment-id-mismatch":
      return { code, retryable: false, message: "Payment proof does not match these payment terms." };
    case "onchain-payment-not-found":
      return { code, retryable: true, message: "Payment was not found on-chain yet." };
    case "insufficient-confirmations":
      return { code, retryable: true, message: "Payment transaction does not have enough confirmations yet." };
    case "provider-timeout":
      return { code, retryable: true, message: "Payment verification timed out. Retry with the same proof." };
    case "provider-error":
      return { code, retryable: true, message: "Payment verification provider call failed. Retry with the same proof." };
    case "payment-already-consumed":
      return { code, retryable: false };
    case "onchain-payment-mismatch":
    case "onchain-payment-not-usable":
    case "wrong-chain":
    case "wrong-factory":
    case "wrong-payment-address":
    case "wrong-payee":
    case "wrong-token":
    case "wrong-amount":
    case "wrong-settlement-time":
    case "failed-transaction":
    case "missing-created-event":
    case "disputed-payment":
    case "resolved-payment":
      return { code, retryable: false, message: "On-chain payment cannot be used for access." };
    default:
      return { code, retryable: false };
  }
}

export function statusForPaymentFailure(
  reason: PaymentFailureReason,
): 422 | 425 | 503 | 504 {
  if (
    reason === "onchain-payment-not-found" ||
    reason === "insufficient-confirmations"
  ) {
    return 425;
  }
  if (reason === "provider-timeout") return 504;
  if (reason === "provider-error" || reason === "reference-provider-error") {
    return 503;
  }
  return 422;
}

export function buildPaymentVerificationErrorResponse(
  init: PaymentVerificationErrorBuilderInput,
): Response {
  return new Response(JSON.stringify({ reason: init.reason }), {
    status: init.status,
    headers: {
      "Content-Type": D402_PAYMENT_REQUEST_CONTENT_TYPE,
      "Cache-Control": "no-store",
    },
  });
}
