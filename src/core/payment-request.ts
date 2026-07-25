import { paymentRequestSchema } from "./schemas.js";
import type { D402PaymentRequest } from "./types.js";

export function parsePaymentRequest(request: unknown): D402PaymentRequest {
  return paymentRequestSchema.parse(request);
}

export function normalizePaymentRequest(
  request: D402PaymentRequest,
): D402PaymentRequest {
  return paymentRequestSchema.parse(request);
}
