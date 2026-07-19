import { D402_PAYMENT_REQUEST_CONTENT_TYPE } from "./constants.js";
import type {
  PaymentRequiredReason,
  PaymentRequiredResponseInit,
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
  code: "missing-proof" = "missing-proof",
): PaymentRequiredReason {
  return {
    code,
    category: "proof",
    retryable: true,
    message: "Payment proof is required.",
  };
}
