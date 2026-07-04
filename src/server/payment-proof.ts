import { Buffer } from "node:buffer";

import { parsePaymentProof } from "../core/index.js";
import type { D402PaymentProof } from "../core/types.js";
import { D402_PAYMENT_PROOF_HEADER } from "./constants.js";

export function decodePaymentProof(value: string): D402PaymentProof {
  if (!value.trim()) {
    throw new Error("encoded payment proof must not be blank");
  }

  const json = Buffer.from(value, "base64url").toString("utf8");
  const parsed = JSON.parse(json) as unknown;

  return parsePaymentProof(parsed);
}

export type PaymentProofReadResult =
  | { ok: true; proof: D402PaymentProof }
  | { ok: false; reason: "missing-proof" | "invalid-proof" };

export function readPaymentProofFromRequest(
  request: Request,
  headerName = D402_PAYMENT_PROOF_HEADER,
): PaymentProofReadResult {
  const value = request.headers.get(headerName);
  if (value === null || !value.trim()) {
    return { ok: false, reason: "missing-proof" };
  }

  try {
    return { ok: true, proof: decodePaymentProof(value) };
  } catch {
    return { ok: false, reason: "invalid-proof" };
  }
}