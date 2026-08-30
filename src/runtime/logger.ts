export type D402LogLevel = "debug" | "info" | "warn" | "error";

export interface D402LogRecord {
  level: D402LogLevel;
  event: string;
  message: string;
  context?: Readonly<Record<string, unknown>>;
}

export type D402Logger = (
  record: D402LogRecord,
) => void | Promise<void>;

export const NoopLogger: D402Logger = () => {};

export function describeError(
  error: unknown,
): Readonly<Record<string, unknown>> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    };
  }

  return { value: String(error) };
}

export function emitLog(
  logger: D402Logger,
  record: D402LogRecord,
): void {
  try {
    const result = logger(record);

    if (result !== undefined) {
      void Promise.resolve(result).catch(() => {});
    }
  } catch {
    // Logging must not affect payment behavior.
  }
}
