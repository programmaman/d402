import canonicalize from "canonicalize";
import { keccak256, toUtf8Bytes } from "ethers";

import { normalizePaymentRequest } from "./payment-request.js";
import { addressSchema } from "./schemas.js";
import type {
  Address,
  D402PaymentRequest,
  Hex32,
} from "./types.js";

export function derivePaymentId(
  request: D402PaymentRequest,
  payerAddress: Address,
  txNonce: bigint,
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
    txNonce: txNonce.toString(),
  });

  if (canonical === undefined) {
    throw new Error("canonicalize returned no output");
  }

  return keccak256(toUtf8Bytes(canonical)) as Hex32;
}
