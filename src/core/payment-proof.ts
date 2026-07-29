import { d402PaymentProofSchema, dPaymentProofSchema } from "./schemas.js";
import type { D402PaymentProof, DPaymentProof } from "./types.js";

export function parseDPaymentProof(proof: unknown): DPaymentProof {
  const parsed = dPaymentProofSchema.parse(proof);

  return {
    version: parsed.version,
    paymentAddress: parsed.paymentAddress,
    txHash: parsed.txHash,
    paymentSalt: parsed.paymentSalt,
  };
}

export function parseD402PaymentProof(proof: unknown): D402PaymentProof {
  const parsed = d402PaymentProofSchema.parse(proof);

  return {
    dPaymentProof: {
      version: parsed.dPaymentProof.version,
      paymentAddress: parsed.dPaymentProof.paymentAddress,
      txHash: parsed.dPaymentProof.txHash,
      paymentSalt: parsed.dPaymentProof.paymentSalt,
    },
    ...(parsed.settlementReference !== undefined
      ? { settlementReference: parsed.settlementReference }
      : {}),
  };
}
