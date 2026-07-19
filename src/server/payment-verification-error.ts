import { D402_PAYMENT_REQUEST_CONTENT_TYPE } from "./constants.js";
import type {
  PaymentVerificationErrorReason,
  PaymentVerificationErrorResponseInit,
  PaymentVerificationFailureReason,
} from "./types.js";

export function buildPaymentVerificationErrorReason(
  code: PaymentVerificationFailureReason,
): PaymentVerificationErrorReason {
  switch (code) {
    case "invalid-proof":
      return { code, retryable: false, message: "Payment proof could not be parsed or validated." };
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
    case "onchain-payment-mismatch":
    case "onchain-payment-not-usable":
    case "wrong-chain":
    case "wrong-factory":
    case "wrong-payment-address":
    case "wrong-payee":
    case "wrong-token":
    case "wrong-amount":
    case "wrong-settlement-time":
    case "wrong-payer":
    case "failed-transaction":
    case "missing-created-event":
    case "disputed-payment":
    case "resolved-payment":
      return { code, retryable: false, message: "On-chain payment cannot be used for access." };
    default:
      return { code, retryable: false };
  }
}

export function buildPaymentVerificationErrorResponse(
  init: PaymentVerificationErrorResponseInit,
): Response {
  return new Response(JSON.stringify({ reason: init.reason }), {
    status: init.status,
    headers: {
      "Content-Type": D402_PAYMENT_REQUEST_CONTENT_TYPE,
      "Cache-Control": "no-store",
    },
  });
}
