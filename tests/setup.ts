/**
 * Vitest global setup — runs before every test file.
 *
 * Forces the context loader to use the in-memory fallback store (which has
 * the demo actors 0.0.100, 0.0.200, 0.0.300) so tests are isolated from
 * whatever real account IDs are in scripts/context_store.json.
 */
process.env.CONTEXT_STORE_PATH = "__vitest_nonexistent__";
