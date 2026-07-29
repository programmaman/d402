import { decodeDPaymentError } from "@rakelabs/dpayments-sdk";

import type { PaymentActions } from "./payment-actions.js";
import type {
  PaymentVerificationResult,
  VerifiedPayment,
} from "./types.js";

export interface PaymentConsumer {
  consume(payment: VerifiedPayment): Promise<PaymentVerificationResult>;
}

export const None: PaymentConsumer = {
  consume(
    payment: VerifiedPayment,
  ): Promise<PaymentVerificationResult> {
    return Promise.resolve({ ok: true, payment });
  },
};

export function Once(
  actions: Pick<PaymentActions, "consumePayment">,
): PaymentConsumer {
  return {
    async consume(
      payment: VerifiedPayment,
    ): Promise<PaymentVerificationResult> {
      try {
        await actions.consumePayment(payment.paymentAddress);
        return { ok: true, payment };
      } catch (error) {
        const decoded = decodeDPaymentError(error);

        if (
          decoded !== null
          && "error" in decoded
          && decoded.error === "AlreadyConsumed"
        ) {
          return {
            ok: false,
            reason: "payment-already-consumed",
          };
        }

        throw error;
      }
    },
  };
}
