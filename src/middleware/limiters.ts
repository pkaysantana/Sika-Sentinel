/**
 * Shared rate-limiter instances for API routes.
 *
 * Keeping them in a single module ensures the same Map is reused across
 * requests in the same process (Next.js server-side singleton).
 */

import { createRateLimiter } from "./rateLimiter";

/** /api/run — 20 requests per minute per IP. */
export const runLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 20 });

/** /api/whitelist — 30 requests per minute per IP. */
export const whitelistLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 30 });
