import canonicalize from "canonicalize";
import { keccak256, toUtf8Bytes } from "ethers";

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
    ...paymentTerms
  } = normalized;
  void expiresAtUnixSec;

  const canonical = canonicalize({
    ...paymentTerms,
    payerAddress: addressSchema.parse(payerAddress),
    paymentSalt: hex32Schema.parse(paymentSalt),
  });

  if (canonical === undefined) {
    throw new Error("canonicalize returned no output");
  }

  return keccak256(toUtf8Bytes(canonical)) as Hex32;
}
