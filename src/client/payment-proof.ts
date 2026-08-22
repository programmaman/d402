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
  return encodeBase64(new TextEncoder().encode(JSON.stringify(normalized)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }
  return globalThis.btoa(binary);
}
