import { Buffer } from "node:buffer";

import { parseD402PaymentProof, parseDPaymentProof } from "../core/index.js";
import type { D402PaymentProof, DPaymentProof } from "../core/types.js";
import { D402_PAYMENT_PROOF_HEADER } from "./constants.js";

export function decodeD402PaymentProof(value: string): D402PaymentProof {
  if (!value.trim()) {
    throw new Error("encoded d402 payment proof must not be blank");
  }

  const json = Buffer.from(value, "base64url").toString("utf8");
  return parseD402PaymentProof(JSON.parse(json) as unknown);
}

export function readD402PaymentProofFromRequest(
  request: Request,
  headerName = D402_PAYMENT_PROOF_HEADER,
): D402PaymentProof | undefined {
  const value = request.headers.get(headerName);
  if (value === null) {
    return undefined;
  }

  return decodeD402PaymentProof(value);
}

/** @deprecated Use decodeD402PaymentProof. */
export function decodePaymentProof(value: string): DPaymentProof {
  if (!value.trim()) throw new Error("encoded payment proof must not be blank");
  const json = Buffer.from(value, "base64url").toString("utf8");
  return parseDPaymentProof(JSON.parse(json) as unknown);
}

export type PaymentProofReadResult =
  | { ok: true; proof: DPaymentProof }
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
    try {
      const decoded = decodeD402PaymentProof(value);
      return { ok: true, proof: decoded.dPaymentProof };
    } catch {
      const json = Buffer.from(value, "base64url").toString("utf8");
      return { ok: true, proof: parseDPaymentProof(JSON.parse(json) as unknown) };
    }
  } catch {
    return { ok: false, reason: "invalid-proof" };
  }
}
