/**
 * Caller store — the authoritative source for "who is allowed to call us
 * as which actor".
 *
 * Storage
 * -------
 *   A JSON file at `data/callers.json` by default (override via
 *   SIKA_CALLERS_PATH). Shape on disk:
 *     {
 *       "callers": [
 *         { "id":"partner-alpha", "kind":"service",
 *           "secretHash":"<sha256-hex>", "permittedActors":["0.0.100"] },
 *         ...
 *       ]
 *     }
 *   The file is validated via Zod on load. Missing file → empty store, which
 *   is fine for greenfield installs and tests.
 *
 * Dev caller
 * ----------
 *   When SIKA_ALLOW_DEV_CALLER is truthy (default: true when NODE_ENV !=
 *   "production"), a synthetic `dev-local` caller is materialised in-memory
 *   at resolve time. It is permitted to act as any actor (["*"]) and has
 *   an empty secretHash — the middleware accepts it without credentials.
 *   In production, dev mode must be explicitly opted in via the env var;
 *   otherwise every request must present a valid caller header pair.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { z } from "zod";
import {
  CallerRecordSchema,
  type CallerRecord,
  type ResolvedCaller,
} from "./schemas";

// ── Store file shape ──────────────────────────────────────────────────────────

const CallerFileSchema = z.object({
  callers: z.array(CallerRecordSchema).default([]),
});

// ── Dev caller ────────────────────────────────────────────────────────────────

/** The synthetic caller used when dev mode is active. */
export const DEV_CALLER_ID = "dev-local";

function devCaller(): CallerRecord {
  return {
    id: DEV_CALLER_ID,
    kind: "dev",
    name: "Local development caller",
    secretHash: "",
    permittedActors: ["*"],
    createdAt: new Date(0).toISOString(),
  };
}

/** True iff dev-caller fallback is enabled for this process. */
export function isDevCallerAllowed(): boolean {
  const raw = process.env.SIKA_ALLOW_DEV_CALLER;
  if (raw !== undefined) {
    return raw === "1" || raw.toLowerCase() === "true";
  }
  // Default: allowed in non-production, blocked otherwise. This keeps the
  // happy dev UI path working while forcing prod deployments to opt in.
  return process.env.NODE_ENV !== "production";
}

// ── File path resolution ──────────────────────────────────────────────────────

const DEFAULT_CALLERS_PATH = path.resolve(process.cwd(), "data/callers.json");

function resolveCallersPath(): string {
  return process.env.SIKA_CALLERS_PATH ?? DEFAULT_CALLERS_PATH;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export interface CallerStore {
  /** Find a caller by id. Returns null if unknown. */
  find(id: string): CallerRecord | null;
  /** All persisted callers (excluding the synthetic dev caller). */
  all(): CallerRecord[];
  /** Re-read the underlying file. */
  reload(): void;
}

class FileCallerStore implements CallerStore {
  private byId = new Map<string, CallerRecord>();

  constructor(private readonly filePath: string) {
    this.reload();
  }

  reload(): void {
    this.byId.clear();
    if (!fs.existsSync(this.filePath)) return;
    const raw = fs.readFileSync(this.filePath, "utf-8");
    if (!raw.trim()) return;
    const parsed = CallerFileSchema.parse(JSON.parse(raw));
    for (const record of parsed.callers) {
      if (this.byId.has(record.id)) {
        throw new Error(
          `Duplicate caller id in caller store: ${record.id}`
        );
      }
      this.byId.set(record.id, record);
    }
  }

  find(id: string): CallerRecord | null {
    return this.byId.get(id) ?? null;
  }

  all(): CallerRecord[] {
    return Array.from(this.byId.values());
  }
}

let _defaultStore: CallerStore | null = null;

/** Process-wide default caller store; lazy so tests can override env first. */
export function getDefaultCallerStore(): CallerStore {
  if (_defaultStore) return _defaultStore;
  _defaultStore = new FileCallerStore(resolveCallersPath());
  return _defaultStore;
}

/** Reset the default store (tests only). */
export function resetDefaultCallerStore(): void {
  _defaultStore = null;
}

/** Construct a store backed by an arbitrary file path. */
export function createFileCallerStore(filePath: string): CallerStore {
  return new FileCallerStore(filePath);
}

/** In-memory store for tests — no disk access. */
export function createMemoryCallerStore(records: CallerRecord[]): CallerStore {
  const byId = new Map<string, CallerRecord>(records.map((r) => [r.id, r]));
  return {
    find(id) {
      return byId.get(id) ?? null;
    },
    all() {
      return Array.from(byId.values());
    },
    reload() {
      /* no-op */
    },
  };
}

// ── Authorisation primitives ─────────────────────────────────────────────────

/**
 * Does `caller` permit acting as `actorId`? "*" is an escape hatch meaning
 * "any actor" and is used by the dev caller and by explicitly-privileged
 * admin entries.
 */
export function canActAs(
  caller: ResolvedCaller | CallerRecord,
  actorId: string
): boolean {
  if (!actorId) return false;
  const permitted = caller.permittedActors;
  if (permitted.includes("*")) return true;
  return permitted.includes(actorId);
}

// ── Secret handling ──────────────────────────────────────────────────────────

/** SHA-256 hex of an arbitrary secret. */
export function hashSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret, "utf-8").digest("hex");
}

/**
 * Constant-time comparison of a presented secret against a stored hash.
 * Always returns false on length mismatch or when either value is empty,
 * which means a caller with `secretHash: ""` (dev caller) will never match
 * via this path — dev mode must go through the dev-fallback branch in the
 * middleware, never through here.
 */
export function verifySecret(presented: string, storedHash: string): boolean {
  if (!presented || !storedHash) return false;
  const presentedHash = hashSecret(presented);
  const a = Buffer.from(presentedHash, "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ── Dev caller helpers ───────────────────────────────────────────────────────

/** Resolve the synthetic dev caller record. */
export function getDevCaller(): CallerRecord {
  return devCaller();
}
