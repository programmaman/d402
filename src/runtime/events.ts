import type {
  D402Event,
  D402EventHandler,
} from "../core/events.js";

export function emitEvent(
  handler: D402EventHandler | undefined,
  event: D402Event,
): void {
  try {
    const result = handler?.(event);
    if (result !== undefined) {
      void Promise.resolve(result).catch(() => {});
    }
  } catch {
    // Event consumers cannot affect payment execution.
  }
}
