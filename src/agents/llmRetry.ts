/**
 * LLM error classification and retry policy.
 *
 * Classification
 * --------------
 *   Errors from LLM providers (LangChain/OpenAI SDK) carry either a `.status`
 *   property (HTTP status code) or a `.code` string. Raw network failures are
 *   plain TypeErrors with no status. We map them to four stable kinds:
 *
 *     client_error  — 4xx: bad request, auth failure, rate-limit (429).
 *                     Retrying will not help — fail fast.
 *     server_error  — 5xx: provider overloaded or internal error.
 *                     These are worth retrying.
 *     network_error — No HTTP response received (ECONNREFUSED, fetch failed, etc.).
 *                     Retrying may help but is risky; for 1B we treat the same as
 *                     server_error and allow retries.
 *     unknown       — Anything else (Zod parse error, logic bug, etc.).
 *                     Do not retry — the same input will produce the same failure.
 *
 * Retry policy
 * ------------
 *   `withLlmRetry` retries only on server_error and network_error.
 *   Default: max 2 retries (3 attempts total), 300 ms fixed delay.
 *   The delay function is injectable so tests run without sleeping.
 */

// ── Error kinds ───────────────────────────────────────────────────────────────

export type LlmErrorKind =
  | "client_error"   // 4xx — do not retry
  | "server_error"   // 5xx — retry
  | "network_error"  // no response — retry
  | "unknown";       // logic / parse error — do not retry

// ── Classification ────────────────────────────────────────────────────────────

/**
 * Extract an HTTP status from an error, if present. LangChain/OpenAI SDK errors
 * expose this as `err.status` (number). Some wrappers use `err.response?.status`.
 */
function httpStatus(err: unknown): number | undefined {
  if (err !== null && typeof err === "object") {
    const e = err as Record<string, unknown>;
    if (typeof e.status === "number") return e.status;
    if (
      e.response !== null &&
      typeof e.response === "object" &&
      typeof (e.response as Record<string, unknown>).status === "number"
    ) {
      return (e.response as Record<string, unknown>).status as number;
    }
  }
  return undefined;
}

/**
 * Classify a thrown error from an LLM call.
 *
 * Usage:
 *   const kind = classifyLlmError(caughtError);
 *   if (kind === "server_error") { // retry }
 */
export function classifyLlmError(err: unknown): LlmErrorKind {
  const status = httpStatus(err);
  if (status !== undefined) {
    if (status >= 500) return "server_error";
    if (status >= 400) return "client_error";
  }

  // Network-level errors: no HTTP response at all.
  // fetch() throws TypeError; node-fetch and undici do similarly.
  if (err instanceof TypeError) return "network_error";

  // Some SDKs use named codes for connectivity issues
  if (err !== null && typeof err === "object") {
    const code = (err as Record<string, unknown>).code;
    if (typeof code === "string") {
      if (
        code === "ECONNREFUSED" ||
        code === "ECONNRESET" ||
        code === "ETIMEDOUT" ||
        code === "UND_ERR_CONNECT_TIMEOUT"
      ) {
        return "network_error";
      }
    }
  }

  // Anything else (schema parse failure, programming error, etc.) — do not retry
  return "unknown";
}

/** True for error kinds that are worth retrying. */
export function isRetryable(kind: LlmErrorKind): boolean {
  return kind === "server_error" || kind === "network_error";
}

// ── Retry wrapper ─────────────────────────────────────────────────────────────

export interface LlmRetryOptions {
  /** Maximum number of retry attempts after the first failure. Default 2. */
  maxRetries?: number;
  /**
   * Called before each retry. Defaults to a 300 ms sleep in production; tests
   * inject a no-op to keep the suite fast.
   */
  delay?: (attempt: number) => Promise<void>;
}

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_DELAY_MS = 300;

/**
 * Call `fn` and retry up to `maxRetries` times when the error is classified
 * as retryable (5xx or network). Non-retryable errors (4xx, unknown) surface
 * immediately without burning retry budget.
 *
 * Throws the last error if all attempts fail.
 */
export async function withLlmRetry<T>(
  fn: () => Promise<T>,
  options: LlmRetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const delay =
    options.delay ??
    ((attempt: number) =>
      new Promise<void>((resolve) =>
        setTimeout(resolve, DEFAULT_DELAY_MS * Math.pow(2, attempt - 1))
      ));

  let lastErr: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const kind = classifyLlmError(err);

      if (!isRetryable(kind)) {
        // 4xx / unknown — retrying won't help; rethrow immediately
        throw err;
      }

      if (attempt < maxRetries) {
        await delay(attempt + 1);
      }
    }
  }

  throw lastErr;
}
