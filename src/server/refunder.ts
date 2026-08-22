import {
  D402_REFUND_REQUEST_CONTENT_TYPE,
} from "../core/index.js";
import type {
  D402BlockReference,
  D402RefundRequest,
} from "../core/index.js";
import {
  refundRequestSchema,
  refundsSchema,
} from "../core/schemas.js";
import { paymentActions } from "./payment-actions.js";
import { FundedPayment } from "./verification-policy.js";
import {
  createDPaymentsAuthenticator,
  createDPaymentsObserver,
  verifyPaymentSalt,
} from "./payment-verifier.js";
import { buildPaymentVerificationErrorReason } from "./payment-verification-error.js";
import type {
  PayableRouteConfig,
  PaymentFailure,
  PaymentFailureReason,
  RefundPolicy,
} from "./types.js";

export function refunder<
  Req extends Request = Request,
  Result = void,
  Res = Response,
>(
  routeConfig: PayableRouteConfig<Req, Result, Res>,
  policy: RefundPolicy<Req>,
): (request: Req) => Promise<Response> {
  if (routeConfig.refunds === undefined) {
    throw new Error(
      "refunder requires the payable route to configure refunds.",
    );
  }
  refundsSchema.parse(routeConfig.refunds);

  const txSender = routeConfig.paymentConfig.txSender;
  if (txSender === undefined) {
    throw new Error(
      "paymentConfig.txSender is required for refunder so the payee can broadcast refunds.",
    );
  }

  const signerAddress = txSender.getAddress();
  const authenticator = createDPaymentsAuthenticator(
    routeConfig.paymentConfig,
  );
  const observer = createDPaymentsObserver(routeConfig.paymentConfig);
  const actions = paymentActions(routeConfig.paymentConfig);

  return async function handleRefundRequest(request: Req): Promise<Response> {
    const parsed = await parseRefundRequest(request);
    if (parsed instanceof Response) {
      return parsed;
    }

    const { paymentRequest, paymentProof } = parsed;
    const { dPaymentProof } = paymentProof;
    const salt = verifyPaymentSalt(paymentRequest, dPaymentProof);
    if (!salt.ok) {
      return paymentFailureResponse(salt, 422);
    }

    const authentication = await authenticator({
      request,
      paymentRequest,
      dPaymentProof,
      ...(paymentProof.settlementReference !== undefined
        ? { settlementReference: paymentProof.settlementReference }
        : {}),
    });
    if (!authentication.ok) {
      return paymentFailureResponse(
        authentication,
        statusForPaymentFailure(authentication.reason),
      );
    }

    const settlementReference: D402BlockReference | undefined =
      paymentProof.settlementReference;
    const authenticated = {
      paymentRequest,
      dPaymentProof,
      payment: authentication.payment,
      ...(settlementReference !== undefined ? { settlementReference } : {}),
    };
    if (
      (await signerAddress).toLowerCase() !==
      paymentRequest.payeeAddress.toLowerCase()
    ) {
      return refundFailureResponse(
        403,
        "refund-signer-not-payee",
        "The configured refund signer is not the authenticated payment payee.",
      );
    }

    const observation = await observer(authenticated);
    if (!observation.ok) {
      return paymentFailureResponse(
        observation,
        statusForPaymentFailure(observation.reason),
      );
    }

    const observed = {
      ...authenticated,
      payment: observation.payment,
    };
    const verification = await FundedPayment.verify(observed);
    if (!verification.ok) {
      return refundFailureResponse(
        409,
        verification.reason,
        verification.message,
      );
    }

    const policyResult = await policy.verify({
      request,
      ...observed,
      ...(parsed.reason !== undefined ? { reason: parsed.reason } : {}),
    });
    if (!policyResult.ok) {
      return refundFailureResponse(
        403,
        policyResult.reason,
        policyResult.message,
      );
    }

    const result = await actions.refundPayment(
      observed.payment.paymentAddress,
    );
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: refundHeaders(),
    });
  };
}

async function parseRefundRequest(
  request: Request,
): Promise<D402RefundRequest | Response> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (
    !contentType.toLowerCase().includes(D402_REFUND_REQUEST_CONTENT_TYPE)
  ) {
    return refundFailureResponse(
      400,
      "invalid-refund-request",
      `Expected Content-Type ${D402_REFUND_REQUEST_CONTENT_TYPE}.`,
    );
  }

  try {
    const body: unknown = await request.clone().json();
    return refundRequestSchema.parse(body);
  } catch {
    return refundFailureResponse(
      400,
      "invalid-refund-request",
      "Could not parse the d402 refund request.",
    );
  }
}

function paymentFailureResponse(
  failure: PaymentFailure,
  status: 422 | 425 | 503 | 504,
): Response {
  const reason = buildPaymentVerificationErrorReason(failure.reason);
  return new Response(JSON.stringify({ reason }), {
    status,
    headers: refundHeaders(),
  });
}

function refundFailureResponse(
  status: 400 | 403 | 409,
  code: PaymentFailureReason,
  message?: string,
): Response {
  return new Response(JSON.stringify({
    reason: {
      code,
      retryable: false,
      ...(message !== undefined ? { message } : {}),
    },
  }), {
    status,
    headers: refundHeaders(),
  });
}

function refundHeaders(): HeadersInit {
  return {
    "Content-Type": D402_REFUND_REQUEST_CONTENT_TYPE,
    "Cache-Control": "no-store",
  };
}

function statusForPaymentFailure(
  reason: PaymentFailureReason,
): 422 | 425 | 503 | 504 {
  if (
    reason === "onchain-payment-not-found" ||
    reason === "insufficient-confirmations"
  ) {
    return 425;
  }
  if (reason === "provider-timeout") return 504;
  if (reason === "provider-error" || reason === "reference-provider-error") {
    return 503;
  }
  return 422;
}
