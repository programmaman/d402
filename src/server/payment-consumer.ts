import {
  D402PaymentExecutionError,
} from "../runtime/payment-execution-error.js";

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
  return {
    async consume(context): Promise<PaymentConsumerResult<void>> {
      try {
        await actions.consumePayment(context.payment.paymentAddress);
        return { ok: true, result: undefined };
      } catch (error) {
        if (
          error instanceof D402PaymentExecutionError &&
          error.dpaymentsError === "AlreadyConsumed"
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
