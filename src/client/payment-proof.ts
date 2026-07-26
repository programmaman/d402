import { Buffer } from "node:buffer";

import { D402_VERSION } from "../core/constants.js";
import { parseD402PaymentProof, parseDPaymentProof } from "../core/index.js";
import type {
  Address,
  D402PaymentProof,
  DPaymentProof,
  Hex32,
} from "../core/types.js";

export interface BuildPaymentProofInput {
  paymentAddress: Address;
  txHash: Hex32;
  paymentSalt: Hex32;
}

export function buildDPaymentProof(input: BuildPaymentProofInput): DPaymentProof {
  return parseDPaymentProof({
    version: D402_VERSION,
    paymentAddress: input.paymentAddress,
    txHash: input.txHash,
    paymentSalt: input.paymentSalt,
  });
}

export function encodeD402PaymentProof(proof: D402PaymentProof): string {
  const normalized = parseD402PaymentProof(proof);
  return Buffer.from(JSON.stringify(normalized), "utf8").toString("base64url");
}
