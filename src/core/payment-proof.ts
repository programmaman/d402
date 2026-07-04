import { paymentProofSchema } from "./schemas.js";
import type { D402PaymentProof } from "./types.js";

export function parsePaymentProof(proof: unknown): D402PaymentProof {
  const parsed = paymentProofSchema.parse(proof);

  return {
    version: parsed.version,
    paymentId: parsed.paymentId,
    paymentAddress: parsed.paymentAddress,
    txHash: parsed.txHash,
    ...(parsed.payerAddress !== undefined ? { payerAddress: parsed.payerAddress } : {}),
  };
}
