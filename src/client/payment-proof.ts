import { Buffer } from "node:buffer";

import { parsePaymentProof } from "../core/index.js";
import type { Address, D402PaymentProof, Hex32 } from "../core/types.js";

export interface BuildPaymentProofInput {
  paymentId: Hex32;
  paymentAddress: Address;
  txHash: Hex32;
  payerAddress?: Address;
}

export function buildPaymentProof(input: BuildPaymentProofInput): D402PaymentProof {
  return parsePaymentProof({
    version: 1,
    ...input,
  });
}

export function encodePaymentProof(proof: D402PaymentProof): string {
  const normalized = parsePaymentProof(proof);
  return Buffer.from(JSON.stringify(normalized), "utf8").toString("base64url");
}