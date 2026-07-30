import {
  D402_CANONICAL_SALT,
  D402_VERSION,
} from "../core/constants.js";
import { normalizePaymentRequest } from "../core/payment-request.js";
import type {
  D402PaymentTerms,
  D402PaymentRequest,
} from "../core/types.js";
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

export function buildPaymentRequest(
  input: D402PaymentTerms,
): D402PaymentRequest {
  return normalizePaymentRequest(input);
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

  return buildPaymentRequest(completeTerms);
}

function completeTermsFromRequest(
  request: Request,
  terms: PayableTerms,
  identifier: PaymentIdentifier | undefined,
): D402PaymentTerms {
  const partialTerms = terms as Partial<D402PaymentTerms>;
  const settlementTimeUnixSec = partialTerms.settlementTimeUnixSec;
  const resolvedResource = partialTerms.resource ?? request.url;

  if (resolvedResource === undefined) {
    throw new Error(
      "resource must be provided by terms.resource or the incoming request URL so the server can build a payment request",
    );
  }

  if (settlementTimeUnixSec === undefined) {
    throw new Error(
      "settlementTimeUnixSec must be provided by paymentConfig.settlementWindow, paymentConfig.settlementTimeUnixSec, or terms.settlementTimeUnixSec",
    );
  }

  const completedRequest = {
    version: partialTerms.version ?? D402_VERSION,
    resource: resolvedResource,
    method: partialTerms.method ?? request.method,
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
      "paymentSalt cannot be configured through payable terms; use paymentConfig.identifier",
    );
  }
}
