/**
 * Lightweight in-memory per-IP rate limiter.
 *
 * Uses a sliding-window counter stored in a plain Map.
 * Designed for demo/preview use — state is per-process and resets on restart.
 *
 * Usage:
 *   const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 20 });
 *   if (!limiter.allow(ip)) return 429;
 */

export interface RateLimiterOptions {
  /** Duration of the window in milliseconds. */
  windowMs: number;
  /** Maximum number of requests allowed per IP within the window. */
  maxRequests: number;
}

interface Entry {
  count: number;
  windowStart: number;
}

export interface RateLimiter {
  /** Returns true if the request is within quota, false if it should be rejected. */
  allow(ip: string): boolean;
}

export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const store = new Map<string, Entry>();

  return {
    allow(ip: string): boolean {
      const now = Date.now();
      const entry = store.get(ip);

      if (!entry || now - entry.windowStart >= opts.windowMs) {
        store.set(ip, { count: 1, windowStart: now });
        return true;
      }

      if (entry.count >= opts.maxRequests) {
        return false;
      }

      entry.count += 1;
      return true;
    },
  };
}
