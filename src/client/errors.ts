import type { D402PaymentAttempt } from "./types.js";

export class D402ClientError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "D402ClientError";
  }
}

export class D402PaymentRequestParseError extends D402ClientError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "D402PaymentRequestParseError";
  }
}

export class D402PolicyViolationError extends D402ClientError {
  constructor(message: string) {
    super(message);
    this.name = "D402PolicyViolationError";
  }
}

export class D402PaymentExecutionError extends D402ClientError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "D402PaymentExecutionError";
  }
}

/**
 * A paid request did not complete after a payment and proof were created.
 * `payment` can be persisted and passed to `client.retry()`.
 */
export class D402PaymentError extends D402ClientError {
  readonly payment: D402PaymentAttempt;
  readonly response: Response | undefined;

  constructor(input: {
    payment: D402PaymentAttempt;
    response: Response | undefined;
    cause: unknown;
  }) {
    super(
      input.cause instanceof Error
        ? input.cause.message
        : "d402 paid request did not complete.",
      { cause: input.cause },
    );
    this.name = "D402PaymentError";
    this.payment = input.payment;
    this.response = input.response;
  }
}

export class D402RequestReplayError extends D402ClientError {
  constructor(message: string) {
    super(message);
    this.name = "D402RequestReplayError";
  }
}

export class D402PaymentActionError extends D402ClientError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "D402PaymentActionError";
  }
}

export class D402ConfigurationError extends D402ClientError {
  constructor(message: string) {
    super(message);
    this.name = "D402ConfigurationError";
  }
}
