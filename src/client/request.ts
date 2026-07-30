import { D402_PAYMENT_REQUEST_CONTENT_TYPE } from "../core/index.js";
import type {
  D402PaymentChallenge,
  D402PaymentRequest,
} from "../core/index.js";
import { paymentChallengeSchema } from "../core/schemas.js";
import {
  D402ConfigurationError,
  D402PaymentRequestParseError,
  D402PolicyViolationError,
  D402RequestReplayError,
} from "./errors.js";
import type { D402ClientResourceResolver } from "./types.js";

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
): Promise<D402PaymentChallenge> {
  const contentType = response.headers.get("Content-Type") ?? "";

  if (
    !contentType
      .toLowerCase()
      .includes(D402_PAYMENT_REQUEST_CONTENT_TYPE)
  ) {
    throw new D402PaymentRequestParseError(
      `402 response is not a d402 payment request. Expected Content-Type ${D402_PAYMENT_REQUEST_CONTENT_TYPE}.`,
    );
  }

  try {
    const body: unknown = await response.json();
    return paymentChallengeSchema.parse(body);
  } catch (cause) {
    throw new D402PaymentRequestParseError(
      "Could not parse d402 payment request body.",
      { cause },
    );
  }
}

export function validatePaymentRequestBinding(input: {
  paymentRequest: D402PaymentRequest;
  request: Request;
  expectedResource?: string;
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

  const expectedResource = input.expectedResource ?? request.url;
  if (paymentRequest.resource !== expectedResource) {
    throw new D402PaymentRequestParseError(
      `Payment request resource does not match expected resource: got ${expectedResource}.`,
    );
  }
}

export function validatePaymentRequestFreshness(
  paymentRequest: D402PaymentRequest,
  nowUnixSec = Math.floor(Date.now() / 1000),
): void {
  if (paymentRequest.expiresAtUnixSec <= nowUnixSec) {
    throw new D402PolicyViolationError(
      `Payment request is expired: expiresAtUnixSec=${paymentRequest.expiresAtUnixSec}, now=${nowUnixSec}.`,
    );
  }
}

export async function validatePaymentRequestForRetry(input: {
  paymentRequest: D402PaymentRequest;
  request: Request;
  resource?: D402ClientResourceResolver;
}): Promise<void> {
  const expectedResource = await resolveClientResource(
    input.request,
    input.resource,
  );
  validatePaymentRequestBinding({
    paymentRequest: input.paymentRequest,
    request: input.request,
    expectedResource,
  });
  validatePaymentRequestFreshness(input.paymentRequest);
}

export async function resolveClientResource(
  request: Request,
  resolver?: D402ClientResourceResolver,
): Promise<string> {
  const resolved = resolver === undefined
    ? request.url
    : typeof resolver === "function"
      ? await resolver(request.clone())
      : resolver;
  const resource = resolved.trim();

  if (resource.length === 0) {
    throw new D402ConfigurationError(
      "Client payment resource must not be blank.",
    );
  }

  return resource;
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
