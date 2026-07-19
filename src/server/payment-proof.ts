import { Buffer } from "node:buffer";

import { parseD402PaymentProof } from "../core/index.js";
import type { D402PaymentProof } from "../core/types.js";
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
