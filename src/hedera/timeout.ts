/**
 * Timeout utilities for Hedera SDK calls.
 *
 * withTimeout() races a promise against a deadline timer and throws a typed
 * HederaTimeoutError when the deadline fires.  Call it around every live
 * Hedera SDK operation so callers receive a consistent, catchable error type
 * instead of an opaque gRPC hang.
 *
 * Additionally, client.setRequestTimeout() is set as a secondary defence so
 * that the SDK's own transport layer also has a bound.
 */

export const DEFAULT_HEDERA_TIMEOUT_MS = 15_000;

/** Thrown when a Hedera SDK call exceeds its configured deadline. */
export class HederaTimeoutError extends Error {
  readonly label: string;
  readonly timeoutMs: number;

  constructor(label: string, timeoutMs: number) {
    super(`Hedera operation timed out after ${timeoutMs}ms: ${label}`);
    this.name = "HederaTimeoutError";
    this.label = label;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Race `promise` against a `ms`-millisecond deadline.
 *
 * @param promise  The async SDK operation to guard.
 * @param ms       Deadline in milliseconds (default: DEFAULT_HEDERA_TIMEOUT_MS).
 * @param label    Human-readable label for the operation — included in the
 *                 error message so on-call can immediately tell what timed out.
 * @throws {HederaTimeoutError} if the deadline fires before the promise resolves.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number = DEFAULT_HEDERA_TIMEOUT_MS,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new HederaTimeoutError(label, ms)), ms);
  });

  try {
    return await Promise.race([promise, deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
