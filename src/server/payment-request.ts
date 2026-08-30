import {
  D402_CANONICAL_SALT,
  D402_VERSION,
} from "../core/constants.js";
import { parsePaymentRequest } from "../core/index.js";
import type { D402PaymentRequest } from "../core/types.js";
import type {
  PaymentIdentifier,
  PayableTerms,
  PayableTermsResolver,
  ResolvedPayableTerms,
} from "./types.js";

export interface BuildServerPaymentRequestInput {
  request: Request;
  terms: ResolvedPayableTerms;
  identifier?: PaymentIdentifier;
}

export async function resolvePayableTerms<
  Req extends Request,
>(
  request: Req,
  resolver: PayableTermsResolver<Req>,
): Promise<ResolvedPayableTerms> {
  const termsBodyRequest = request.clone();
  const terms = typeof resolver === "function"
    ? await resolver(termsBodyRequest, {
        originalRequest: request,
        bodyRequest: termsBodyRequest,
      })
    : resolver;
  const { resource, ...paymentTerms } = terms;
  let resolvedResource: string | undefined;

  if (resource !== undefined) {
    if (typeof resource === "function") {
      const resourceBodyRequest = request.clone();
      resolvedResource = await resource(resourceBodyRequest, {
        originalRequest: request,
        bodyRequest: resourceBodyRequest,
      });
    } else {
      resolvedResource = resource;
    }
  }

  return {
    ...paymentTerms,
    ...(resolvedResource !== undefined ? { resource: resolvedResource } : {}),
  };
}

export function buildServerPaymentRequest(
  input: BuildServerPaymentRequestInput,
): D402PaymentRequest {
  assertPayableTermsDoNotSelectSalt(input.terms);

  const completeTerms = completeTermsFromRequest(
    input.request,
    input.terms,
    input.identifier,
  );

  return parsePaymentRequest(completeTerms);
}

function completeTermsFromRequest(
  request: Request,
  terms: ResolvedPayableTerms,
  identifier: PaymentIdentifier | undefined,
): D402PaymentRequest {
  const settlementTimeUnixSec = terms.settlementTimeUnixSec;
  const resolvedResource = terms.resource ?? request.url;

  if (resolvedResource === undefined) {
    throw new Error(
      "resource must be provided by terms.resource or the incoming request URL so the server can build a payment request",
    );
  }

  if (settlementTimeUnixSec === undefined) {
    throw new Error(
      "settlementTimeUnixSec must be provided by payment.settlementWindow, payment.settlementTimeUnixSec, or terms.settlementTimeUnixSec",
    );
  }

  const completedRequest = {
    version: terms.version ?? D402_VERSION,
    resource: resolvedResource,
    method: terms.method ?? request.method,
    chainId: terms.chainId,
    payeeAddress: terms.payeeAddress,
    tokenAddress: terms.tokenAddress,
    netAmount: terms.netAmount,
    settlementTimeUnixSec,
    agreement: terms.agreement,
    expiresAtUnixSec: terms.expiresAtUnixSec,
  };

  return {
    ...completedRequest,
    ...(identifier === "client"
      ? {}
      : { paymentSalt: D402_CANONICAL_SALT }),
  };
}

function assertPayableTermsDoNotSelectSalt(
  terms: PayableTerms,
): void {
  if (Object.prototype.hasOwnProperty.call(terms, "paymentSalt")) {
    throw new Error(
      "paymentSalt cannot be configured through payable terms; use payment.identifier",
    );
  }
}
