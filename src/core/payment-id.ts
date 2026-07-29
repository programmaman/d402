import canonicalize from "canonicalize";
import { keccak256, toUtf8Bytes } from "ethers";

import { D402_CANONICAL_SALT } from "./constants.js";
import { normalizePaymentRequest } from "./payment-request.js";
import { addressSchema, hex32Schema } from "./schemas.js";
import type {
  Address,
  D402PaymentRequest,
  Hex32,
} from "./types.js";

export function derivePaymentId(
  request: D402PaymentRequest,
  payerAddress: Address,
  paymentSalt: Hex32,
): Hex32 {
  const normalized = normalizePaymentRequest(request);
  const {
    expiresAtUnixSec,
    paymentSalt: requestedPaymentSalt,
    ...paymentTerms
  } = normalized;
  void expiresAtUnixSec;

  const effectivePaymentSalt = hex32Schema.parse(paymentSalt);
  if (
    requestedPaymentSalt !== undefined
    && requestedPaymentSalt !== effectivePaymentSalt
  ) {
    throw new Error("paymentSalt does not match payment request");
  }
  if (
    requestedPaymentSalt === undefined
    && effectivePaymentSalt === D402_CANONICAL_SALT
  ) {
    throw new Error(
      "client-identified payment cannot use the canonical salt",
    );
  }

  const canonical = canonicalize({
    ...paymentTerms,
    payerAddress: addressSchema.parse(payerAddress),
    paymentSalt: effectivePaymentSalt,
  });

  if (canonical === undefined) {
    throw new Error("canonicalize returned no output");
  }

  return keccak256(toUtf8Bytes(canonical)) as Hex32;
}
