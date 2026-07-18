import { D402_PAYMENT_REQUEST_CONTENT_TYPE } from "./constants.js";
import type { PaymentVerificationErrorResponseInit } from "./types.js";

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
