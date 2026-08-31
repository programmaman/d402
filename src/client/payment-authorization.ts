import {
  encodeBase64Url,
} from "../core/index.js";
import type { D402PaymentAuthorization } from "../core/index.js";

export function encodeD402PaymentAuthorization(
  authorization: D402PaymentAuthorization,
): string {
  return encodeBase64Url(
    new TextEncoder().encode(
      JSON.stringify(authorization),
    ),
  );
}
