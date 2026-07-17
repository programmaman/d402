import type {D402PaymentRequest} from "../core/index.js";
import {parsePaymentRequest} from "../core/index.js";
import {D402PaymentRequestParseError, D402RequestReplayError} from "./errors.js";

export interface PreparedD402Request {
  initial: Request;
  retry: Request;
}

export function prepareReusableRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): PreparedD402Request {
  const request = new Request(input, init);

  try {
    return {
      initial: request,
      retry: request.clone(),
    };
  } catch {
    throw new D402RequestReplayError(
      "Request body cannot be safely replayed for a d402 payment retry. Use a buffered body or disable automatic replay for this request.",
    );
  }
}

export async function parsePaymentRequiredResponse(
  response: Response,
): Promise<D402PaymentRequest> {
  const contentType = response.headers.get("Content-Type") ?? "";

  if (!contentType.toLowerCase().includes("application/d402+json")) {
    throw new D402PaymentRequestParseError(
      "402 response is not a d402 payment request. Expected Content-Type application/d402+json.",
    );
  }

  try {
    return parsePaymentRequest(parsePaymentRequiredResponseBody(await response.json()));
  } catch (cause) {
    throw new D402PaymentRequestParseError(
      "Could not parse d402 payment request body.",
      { cause },
    );
  }
}

function parsePaymentRequiredResponseBody(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }

  return (value as Record<string, unknown>).paymentRequest;
}

export function validatePaymentRequestBinding(input: {
  paymentRequest: D402PaymentRequest;
  request: Request;
}): void {
  const { paymentRequest, request } = input;

  if (
    paymentRequest.method !== undefined &&
    paymentRequest.method !== request.method.toUpperCase()
  ) {
    throw new D402PaymentRequestParseError(
      `Payment request method does not match original request: got ${request.method.toUpperCase()}.`,
    );
  }

  if (paymentRequest.resource !== request.url) {
    throw new D402PaymentRequestParseError(
      `Payment request resource does not match original request: got ${request.url}.`,
    );
  }
}

export function assertNoExistingProof(
  request: Request,
  proofHeaderName: string,
): void {
  if (request.headers.has(proofHeaderName)) {
    throw new D402RequestReplayError(
      `Request already contains a d402 payment proof header (${proofHeaderName}); the client will not replay a request that already carries a proof.`,
    );
  }
}

export function withPaymentProofHeader(
  request: Request,
  proofHeaderName: string,
  encodedProof: string,
): Request {
  const headers = new Headers(request.headers);
  headers.set(proofHeaderName, encodedProof);

  return new Request(request, { headers });
}
