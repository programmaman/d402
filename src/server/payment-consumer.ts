import { decodeDPaymentError } from "@rakelabs/dpayments-sdk";

import type {
  PaymentActions,
  PaymentFailure,
  ObservedPaymentContext,
} from "./types.js";

export type PaymentConsumerResult<Result> =
  | { ok: true; result: Result }
  | PaymentFailure;

export interface PaymentConsumer<Result = void> {
  consume(
    context: Readonly<ObservedPaymentContext>,
  ): Promise<PaymentConsumerResult<Result>>;
}

export const None: PaymentConsumer<void> = Object.freeze({
  consume(): Promise<PaymentConsumerResult<void>> {
    return Promise.resolve({ ok: true, result: undefined });
  },
});

export function Once(
  actions: Pick<PaymentActions, "consumePayment">,
): PaymentConsumer<void> {
  throw new Error(
    "Once() is temporarily disabled. TODO: remove this blocker once the on-chain consumption logic is updated.",
  );

  return {
    async consume(context): Promise<PaymentConsumerResult<void>> {
      try {
        await actions.consumePayment(context.payment.paymentAddress);
        return { ok: true, result: undefined };
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
