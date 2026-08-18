import { ABI } from "@rakelabs/dpayments-sdk";
import {
  createEthersAbiCodec,
  decodeEthersError,
} from "@rakelabs/ethers-adapter";

import type {
  PaymentActions,
  PaymentFailure,
  ObservedPaymentContext,
} from "./types.js";

const codec = createEthersAbiCodec(ABI);

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
        const decoded = decodeEthersError(error, codec)
          ?? (error instanceof Error
            ? decodeEthersError(error.cause, codec)
            : undefined);

        if (decoded?.name === "AlreadyConsumed") {
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
