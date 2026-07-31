import {
  D402_REFUND_REQUEST_CONTENT_TYPE,
} from "../core/index.js";
import type {
  D402PaymentActionResult,
  D402RefundRequest,
  D402RefundRoute,
} from "../core/index.js";
import { paymentActionResultSchema } from "../core/schemas.js";
import { D402RefundRequestError } from "./errors.js";

export async function requestRefund(input: {
  route: D402RefundRoute;
  refundRequest: D402RefundRequest;
  fetch: typeof globalThis.fetch;
}): Promise<D402PaymentActionResult> {
  const response = await input.fetch(input.route.url, {
    method: "POST",
    headers: {
      "Content-Type": D402_REFUND_REQUEST_CONTENT_TYPE,
    },
    body: JSON.stringify(input.refundRequest),
  });

  if (!response.ok) {
    throw new D402RefundRequestError(
      `Refund request failed with HTTP ${response.status}.`,
      response,
    );
  }

  try {
    const body: unknown = await response.clone().json();
    return paymentActionResultSchema.parse(body);
  } catch (cause) {
    throw new D402RefundRequestError(
      "Could not parse the d402 refund response.",
      response,
      { cause },
    );
  }
}
