import {
  D402_PAYMENT_AUTHORIZATION_HEADER,
  decodeBase64Url,
  parseD402PaymentAuthorization,
} from "../core/index.js";
import type { D402PaymentAuthorization } from "../core/index.js";

export function readD402PaymentAuthorizationFromRequest(
  request: Request,
  headerName = D402_PAYMENT_AUTHORIZATION_HEADER,
): D402PaymentAuthorization | undefined {
  const value = request.headers.get(headerName);

  if (value === null) {
    return undefined;
  }

  const json = new TextDecoder().decode(
    decodeBase64Url(value),
  );

  return parseD402PaymentAuthorization(
    JSON.parse(json) as unknown,
  );
}
