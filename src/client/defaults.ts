import { D402PaymentAction } from "./types.js";
import type { D402ResponseValidator } from "./types.js";

const responseValidator: D402ResponseValidator = {
  validate({ response }) {
    return response.ok
      ? { accepted: true }
      : { accepted: false, reason: `HTTP ${response.status}` };
  },
};

export const defaultResponseValidator = Object.freeze(responseValidator);

export const defaultPaymentActions = Object.freeze({
  OnAccepted: D402PaymentAction.KeepOpen,
  OnRejected: D402PaymentAction.KeepOpen,
});
