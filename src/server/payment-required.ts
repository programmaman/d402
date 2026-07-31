import type {
  D402PaymentChallenge,
  D402PaymentRequiredReason,
  D402PaymentRequiredReasonCode,
} from "../core/index.js";
import { D402_PAYMENT_REQUEST_CONTENT_TYPE } from "../core/index.js";

export function buildPaymentRequiredResponse(
  init: D402PaymentChallenge,
): Response {
  return new Response(JSON.stringify(init), {
    status: 402,
    headers: {
      "Content-Type": D402_PAYMENT_REQUEST_CONTENT_TYPE,
      "Cache-Control": "no-store",
    },
  });
}

export function buildPaymentRequiredReason(
  code: D402PaymentRequiredReasonCode = "missing-proof",
): D402PaymentRequiredReason {
  return {
    code,
    category: "proof",
    retryable: true,
    message: "Payment proof is required.",
  };
}
