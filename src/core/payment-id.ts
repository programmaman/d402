import canonicalize from "canonicalize";
import { keccak256, toUtf8Bytes } from "ethers";

import { D402_CANONICAL_SALT } from "./constants.js";
import { parsePaymentRequest } from "./payment-request.js";
import { addressSchema, hex32Schema } from "./schemas.js";
import type {
  Address,
  D402PaymentRequest,
  D402PaymentSaltValidation,
  Hex32,
} from "./types.js";

export function derivePaymentId(
  request: D402PaymentRequest,
  payerAddress: Address,
  paymentSalt: Hex32,
): Hex32 {
  const normalized = parsePaymentRequest(request);
  const {
    expiresAtUnixSec,
    paymentSalt: requestedPaymentSalt,
    ...paymentTerms
  } = normalized;
  void expiresAtUnixSec;

  const effectivePaymentSalt = hex32Schema.parse(paymentSalt);
  const saltValidation = validatePaymentSalt(normalized, effectivePaymentSalt);
  if (!saltValidation.ok) {
    if (requestedPaymentSalt === undefined) {
      throw new Error(
        "client-identified payment cannot use the canonical salt",
      );
    }
    throw new Error("paymentSalt does not match payment request");
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

export function validatePaymentSalt(
  paymentRequest: D402PaymentRequest,
  paymentSalt: Hex32,
): D402PaymentSaltValidation {
  if (
    paymentRequest.paymentSalt !== undefined
    && paymentRequest.paymentSalt !== paymentSalt
  ) {
    return { ok: false, reason: "payment-id-mismatch" };
  }

  if (
    paymentRequest.paymentSalt === undefined
    && paymentSalt === D402_CANONICAL_SALT
  ) {
    return { ok: false, reason: "payment-id-mismatch" };
  }

  return { ok: true };
}
