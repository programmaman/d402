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

export class D402ResponseValidationError extends D402ClientError {
  constructor(message: string) {
    super(message);
    this.name = "D402ResponseValidationError";
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
