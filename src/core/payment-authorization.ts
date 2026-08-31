import { d402PaymentAuthorizationSchema } from "./schemas.js";
import type { D402PaymentAuthorization } from "./types.js";

export function parseD402PaymentAuthorization(
  authorization: unknown,
): D402PaymentAuthorization {
  return d402PaymentAuthorizationSchema.parse(authorization);
}
