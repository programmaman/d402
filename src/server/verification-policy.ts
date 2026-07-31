import type {
  ObservedPaymentContext,
  VerificationPolicy,
  VerificationPolicyResult,
} from "./types.js";

export const UsablePayment: VerificationPolicy = Object.freeze({
  verify(
    context: Readonly<ObservedPaymentContext>,
  ): VerificationPolicyResult {
    const { state } = context.payment;
    if (state === "funded" || state === "settled") {
      return { ok: true };
    }

    return {
      ok: false,
      reason: state === "disputed"
        ? "disputed-payment"
        : "resolved-payment",
    };
  },
});

/** Accepts only a payment that can still take the on-chain refund transition. */
export const RefundablePayment: VerificationPolicy = Object.freeze({
  verify(
    context: Readonly<ObservedPaymentContext>,
  ): VerificationPolicyResult {
    if (context.payment.state === "funded") {
      return { ok: true };
    }

    return {
      ok: false,
      reason: "payment-not-refundable",
    };
  },
});
