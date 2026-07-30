import { d402PaymentProofSchema, dPaymentProofSchema } from "./schemas.js";
import type { D402PaymentProof, DPaymentProof } from "./types.js";

export function parseDPaymentProof(proof: unknown): DPaymentProof {
  return dPaymentProofSchema.parse(proof);
}

export function parseD402PaymentProof(proof: unknown): D402PaymentProof {
  return d402PaymentProofSchema.parse(proof);
}
