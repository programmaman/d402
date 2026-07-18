import { d402PaymentProofSchema, dPaymentProofSchema } from "./schemas.js";
import type { D402PaymentProof, DPaymentProof } from "./types.js";

export function parseDPaymentProof(proof: unknown): DPaymentProof {
  const parsed = dPaymentProofSchema.parse(proof);

  return {
    version: parsed.version,
    paymentId: parsed.paymentId,
    paymentAddress: parsed.paymentAddress,
    txHash: parsed.txHash,
    payerAddress: parsed.payerAddress,
  };
}

export function parseD402PaymentProof(proof: unknown): D402PaymentProof {
  const parsed = d402PaymentProofSchema.parse(proof);

  return {
    dPaymentProof: parseDPaymentProof(parsed.dPaymentProof),
    ...(parsed.settlementReference !== undefined
      ? { settlementReference: parsed.settlementReference }
      : {}),
  };
}

/** @deprecated Use parseDPaymentProof for the underlying payment proof. */
export const parsePaymentProof = parseDPaymentProof;
