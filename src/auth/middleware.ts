/**
 * Caller resolution middleware.
 *
 * resolveCaller() is called at the top of every authenticated route. It
 * inspects the request headers, verifies the caller credential against the
 * store, and returns a ResolvedCaller (on success) or a structured error
 * (on failure) that the route can turn into a 401/403 response.
 *
 * Why not Next.js middleware?
 * ---------------------------
 *   Next.js's `middleware.ts` runs on the edge runtime and cannot use
 *   Node crypto / fs APIs. The caller store lives on disk and uses Node
 *   crypto for timing-safe equality, so auth has to run inside the route
 *   handler. Exposing a pure helper lets each handler call it once and
 *   short-circuit with the appropriate status.
 *
 * Headers
 * -------
 *   x-sika-caller           — caller id (e.g. "partner-alpha", "dev-local")
 *   x-sika-caller-secret    — plaintext secret, hashed and compared against
 *                             the stored SHA-256 hash.
 *
 * Dev mode
 * --------
 *   If SIKA_ALLOW_DEV_CALLER is enabled AND the request either omits the
 *   caller header or presents `dev-local` with any (or no) secret, the
 *   synthetic dev caller is resolved. This keeps the local UI working
 *   without forcing developers to juggle secrets. In production, dev mode
 *   is off by default, so the same request path would be rejected with 401.
 */

import type { NextRequest } from "next/server";
import {
  DEV_CALLER_ID,
  canActAs,
  getDefaultCallerStore,
  getDevCaller,
  isDevCallerAllowed,
  verifySecret,
  type CallerStore,
} from "./callers";
import type { CallerRecord, ResolvedCaller } from "./schemas";

// ── Header names ─────────────────────────────────────────────────────────────

export const CALLER_ID_HEADER = "x-sika-caller";
export const CALLER_SECRET_HEADER = "x-sika-caller-secret";

// ── Result types ─────────────────────────────────────────────────────────────

/**
 * Outcome of a resolve attempt. On success, `caller` is populated and
 * `error` is null. On failure, `error` + `status` describe the rejection
 * and `caller` is null. This shape is friendlier than throwing because
 * route handlers can pattern-match without wrapping in try/catch.
 */
export type ResolveCallerResult =
  | { ok: true; caller: ResolvedCaller }
  | { ok: false; status: 401 | 403; error: string };

// ── Request shape ────────────────────────────────────────────────────────────

/**
 * Minimal header accessor — both `NextRequest` and the standard `Request`
 * class expose this. Declaring the narrow shape lets tests pass plain
 * objects without needing to construct a full Next request.
 */
export interface HeaderBag {
  get(name: string): string | null;
}

export interface HeaderCarrier {
  headers: HeaderBag;
}

// ── Resolution ───────────────────────────────────────────────────────────────

function toResolved(record: CallerRecord): ResolvedCaller {
  return {
    id: record.id,
    kind: record.kind,
    permittedActors: record.permittedActors,
  };
}

/**
 * Resolve the caller for a request. Accepts either a NextRequest or any
 * object that exposes a `headers.get()` method, so it's trivially testable.
 *
 * The `store` argument defaults to the process-wide caller store but can
 * be overridden by tests to inject a MemoryCallerStore.
 */
export function resolveCaller(
  req: HeaderCarrier | NextRequest,
  store: CallerStore = getDefaultCallerStore()
): ResolveCallerResult {
  const rawId = req.headers.get(CALLER_ID_HEADER)?.trim() ?? "";
  const rawSecret = req.headers.get(CALLER_SECRET_HEADER) ?? "";
  const devAllowed = isDevCallerAllowed();

  // Dev fallback — missing id OR explicit dev id, and dev mode is on.
  if (!rawId || rawId === DEV_CALLER_ID) {
    if (devAllowed) {
      return { ok: true, caller: toResolved(getDevCaller()) };
    }
    return {
      ok: false,
      status: 401,
      error: "Missing caller credentials",
    };
  }

  const record = store.find(rawId);
  if (!record) {
    return {
      ok: false,
      status: 401,
      error: `Unknown caller: ${rawId}`,
    };
  }

  if (!verifySecret(rawSecret, record.secretHash)) {
    return {
      ok: false,
      status: 401,
      error: "Invalid caller secret",
    };
  }

  return { ok: true, caller: toResolved(record) };
}

// ── Authorisation ────────────────────────────────────────────────────────────

/**
 * Convenience: resolve + canActAs in one call. Returns `{ ok: true }` with
 * the caller when the credential checks out AND the caller is permitted to
 * act as `actorId`, otherwise the appropriate `{ ok: false, ... }` error.
 */
export function authorizeActor(
  req: HeaderCarrier | NextRequest,
  actorId: string,
  store?: CallerStore
): ResolveCallerResult {
  const resolved = resolveCaller(req, store);
  if (!resolved.ok) return resolved;
  if (!canActAs(resolved.caller, actorId)) {
    return {
      ok: false,
      status: 403,
      error: `Caller '${resolved.caller.id}' is not permitted to act as '${actorId}'`,
    };
  }
  return resolved;
}
