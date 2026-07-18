import { D402_PAYMENT_REQUEST_CONTENT_TYPE } from "./constants.js";
import type {
  PaymentRequiredReason,
  PaymentRequiredResponseInit,
  PaymentVerificationFailureReason,
} from "./types.js";

export function buildPaymentRequiredResponse(
  init: PaymentRequiredResponseInit,
): Response {
  return new Response(JSON.stringify({
    paymentRequest: init.paymentRequest,
    ...(init.settlementReference !== undefined
      ? { settlementReference: init.settlementReference }
      : {}),
    reason: init.reason,
  }), {
    status: 402,
    headers: {
      "Content-Type": D402_PAYMENT_REQUEST_CONTENT_TYPE,
      "Cache-Control": "no-store",
    },
  });
}

export function buildPaymentRequiredReason(
  code: PaymentVerificationFailureReason,
): PaymentRequiredReason {
  switch (code) {
    case "missing-proof":
      return {
        code,
        category: "proof",
        retryable: true,
        message: "Payment proof is required.",
      };
    case "invalid-proof":
      return {
        code,
        category: "proof",
        retryable: true,
        message: "Payment proof could not be parsed or validated.",
      };
    case "payment-request-expired":
      return {
        code,
        category: "request",
        retryable: true,
        message: "Payment request expired. Request fresh payment terms.",
      };
    case "payment-id-mismatch":
      return {
        code,
        category: "proof",
        retryable: true,
        message: "Payment proof does not match these payment terms.",
      };
    case "onchain-payment-not-found":
      return {
        code,
        category: "chain",
        retryable: true,
        message: "Payment was not found on-chain yet.",
      };
    case "onchain-payment-mismatch":
      return {
        code,
        category: "chain",
        retryable: false,
        message: "On-chain payment does not match these payment terms.",
      };
    case "onchain-payment-not-usable":
      return {
        code,
        category: "chain",
        retryable: false,
        message: "On-chain payment cannot be used for access.",
      };
    case "provider-error":
      return {
        code,
        category: "chain",
        retryable: true,
        message: "Payment verification provider call failed. Retry with a reliable provider.",
      };
    case "unsupported-chain":
      return {
        code,
        category: "chain",
        retryable: false,
        message: "Payment request chain is not supported.",
      };
    case "wrong-chain":
      return {
        code,
        category: "chain",
        retryable: false,
        message: "Connected provider chain does not match the payment request chain.",
      };
    case "insufficient-confirmations":
      return {
        code,
        category: "chain",
        retryable: true,
        message: "Payment transaction does not have enough confirmations yet.",
      };
    case "missing-created-event":
      return {
        code,
        category: "chain",
        retryable: false,
        message: "Payment transaction did not include a DPayments PaymentCreated event.",
      };
    case "failed-transaction":
      return {
        code,
        category: "chain",
        retryable: false,
        message: "Payment transaction failed.",
      };
    case "wrong-factory":
    case "wrong-payment-address":
    case "wrong-payee":
    case "wrong-token":
    case "wrong-amount":
    case "wrong-settlement-time":
    case "wrong-payer":
      return {
        code,
        category: "chain",
        retryable: false,
        message: "On-chain payment does not match these payment terms.",
      };
    case "disputed-payment":
    case "resolved-payment":
      return {
        code,
        category: "chain",
        retryable: false,
        message: "On-chain payment cannot be used for access.",
      };
    default:
      return {
        code,
        category: "policy",
        retryable: false,
      };
  }
}
