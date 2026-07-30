import { paymentRequestSchema } from "./schemas.js";
import type { D402PaymentRequest } from "./types.js";

export function parsePaymentRequest(request: unknown): D402PaymentRequest {
  return paymentRequestSchema.parse(request);
}
