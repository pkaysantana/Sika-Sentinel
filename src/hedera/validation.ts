/**
 * Hedera account ID validation utilities.
 *
 * The canonical Hedera account ID format is: <shard>.<realm>.<num>
 * For the Hedera public network this is always 0.0.<num>.
 *
 * These helpers are used at two layers:
 *   1. Schema level — Zod refinements in action.ts enforce the format on
 *      every Action that enters the system.
 *   2. SDK boundary — assertValidHederaId() is called immediately before
 *      AccountId.fromString() so that malformed IDs produce a clear,
 *      typed error rather than a cryptic SDK exception.
 */

// Matches <shard>.<realm>.<num> — all three segments must be numeric.
const HEDERA_ID_RE = /^\d+\.\d+\.\d+$/;

/** Returns true if `id` is a syntactically valid Hedera account ID. */
export function isValidHederaId(id: string): boolean {
  return HEDERA_ID_RE.test(id);
}

/**
 * Asserts that `id` is a valid Hedera account ID.
 * @throws {Error} with a human-readable message if validation fails.
 */
export function assertValidHederaId(id: string, label = "account ID"): void {
  if (!isValidHederaId(id)) {
    throw new Error(
      `Invalid Hedera ${label}: "${id}" — expected format <shard>.<realm>.<num> (e.g. 0.0.800)`
    );
  }
}
