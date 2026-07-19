import { Buffer } from "node:buffer";

import { parseD402PaymentProof, parseDPaymentProof } from "../core/index.js";
import type {
  Address,
  D402PaymentProof,
  DPaymentProof,
  Hex32,
} from "../core/types.js";

export interface BuildPaymentProofInput {
  paymentId: Hex32;
  paymentAddress: Address;
  txHash: Hex32;
  payerAddress: Address;
}

export function buildDPaymentProof(input: BuildPaymentProofInput): DPaymentProof {
  return parseDPaymentProof({
    version: 1,
    ...input,
  });
}

export function encodeD402PaymentProof(proof: D402PaymentProof): string {
  const normalized = parseD402PaymentProof(proof);
  return Buffer.from(JSON.stringify(normalized), "utf8").toString("base64url");
}
