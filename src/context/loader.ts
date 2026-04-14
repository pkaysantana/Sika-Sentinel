/**
 * Context Engine — loads policy-relevant state for an Action.
 *
 * Store resolution order:
 *   1. Path given by the CONTEXT_STORE_PATH environment variable
 *   2. scripts/context_store.json  (default fixture location)
 *   3. Built-in in-memory fallback  (demo always works, even without a file)
 */

import { z } from "zod";
import fs from "fs";
import path from "path";
import { promises as fsPromises } from "fs";

// ── Enums ─────────────────────────────────────────────────────────────────────

export const TreasuryPostureSchema = z.enum(["NORMAL", "RESTRICTED", "FROZEN"]);
export type TreasuryPosture = z.infer<typeof TreasuryPostureSchema>;

export const ActorRoleSchema = z.enum(["OPERATOR", "PARTNER", "ADMIN"]);
export type ActorRole = z.infer<typeof ActorRoleSchema>;

// ── ContextSnapshot ───────────────────────────────────────────────────────────

export const ContextSnapshotSchema = z.object({
  actorId: z.string(),
  actorRole: ActorRoleSchema,
  partnerId: z.string(),
  amountThresholdHbar: z.number(),
  approvedRecipients: z.array(z.string()).default([]),
  treasuryPosture: TreasuryPostureSchema.default("NORMAL"),
  enforceRecipientAllowlist: z.boolean().default(true),
});

export type ContextSnapshot = z.infer<typeof ContextSnapshotSchema>;

// Backwards-compatible alias
export type PolicyContext = ContextSnapshot;

// ── Store schema (internal) ───────────────────────────────────────────────────

const ActorRecordSchema = z.object({
  role: ActorRoleSchema,
  partner_id: z.string(),
  amount_threshold_hbar: z.number(),
  approved_recipients: z.array(z.string()).default([]),
  enforce_recipient_allowlist: z.boolean().default(true),
});

const TreasuryRecordSchema = z.object({
  posture: TreasuryPostureSchema.default("NORMAL"),
});

const ContextStoreSchema = z.object({
  treasury: TreasuryRecordSchema.default({ posture: "NORMAL" }),
  actors: z.record(z.string(), ActorRecordSchema).default({}),
});

type ContextStore = z.infer<typeof ContextStoreSchema>;

// ── In-memory fallback ────────────────────────────────────────────────────────

// Returns a fresh deep copy each time so mutations (e.g. setTreasuryPosture)
// don't bleed across calls to reloadStore() — critical for test isolation.
function buildFallbackStore(): ContextStore {
  return {
    treasury: { posture: "NORMAL" },
    actors: {
      "0.0.100": {
        role: "OPERATOR",
        partner_id: "partner-alpha",
        amount_threshold_hbar: 100.0,
        approved_recipients: ["0.0.800", "0.0.801"],
        enforce_recipient_allowlist: true,
      },
      "0.0.200": {
        role: "PARTNER",
        partner_id: "partner-beta",
        amount_threshold_hbar: 25.0,
        approved_recipients: ["0.0.800"],
        enforce_recipient_allowlist: true,
      },
      "0.0.300": {
        role: "ADMIN",
        partner_id: "internal-ops",
        amount_threshold_hbar: 500.0,
        approved_recipients: [],
        enforce_recipient_allowlist: false,
      },
    },
  };
}

// Request-scoped store: reloaded on each reloadStore() call.
// This avoids the process-level singleton mutation problem while
// keeping mutations visible within the same request.
let _store: ContextStore | null = null;
let _treasuryPostureOverride: TreasuryPosture | null = null;

// ── Store loading ─────────────────────────────────────────────────────────────

// process.cwd() is the project root in both Next.js server bundles and Node scripts.
// __dirname is NOT safe here — Next.js webpack bundles rewrite it to the .next output dir.
const DEFAULT_STORE_PATH = path.resolve(
  process.cwd(),
  "scripts/context_store.json"
);

function resolveStorePath(): string {
  return process.env.CONTEXT_STORE_PATH ?? DEFAULT_STORE_PATH;
}

/**
 * Load store from file or fallback, caching for the current request/scope.
 * When reloadStore() is called (e.g., at the start of a new request or test),
 * the cache is cleared and a fresh copy is loaded from file.
 */
function loadStore(): ContextStore {
  if (_store !== null) return _store;

  const storePath = resolveStorePath();
  let store: ContextStore;

  if (fs.existsSync(storePath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(storePath, "utf-8"));
      store = ContextStoreSchema.parse(raw);
    } catch (err) {
      console.warn(
        `Failed to parse context store at ${storePath} (${err}); using fallback`
      );
      store = buildFallbackStore();
    }
  } else {
    store = buildFallbackStore();
  }

  // Apply treasury posture override if set (for testing)
  if (_treasuryPostureOverride !== null) {
    store.treasury.posture = _treasuryPostureOverride;
  }

  _store = store;
  return _store;
}

/**
 * Clear the request-scoped cache and any overrides.
 * Call this at the start of each request/test to ensure a fresh file read.
 */
export function reloadStore(): void {
  _store = null;
  _treasuryPostureOverride = null;
}

/** Override the in-memory treasury posture for the current scope (tests). */
export function setTreasuryPosture(posture: TreasuryPosture): void {
  _treasuryPostureOverride = posture;
  // Clear the cached store so it's reloaded with the new override
  _store = null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Load policy-relevant context for the given actor.
 *
 * @throws {Error} If actorId is not found in the context store.
 */
export function loadContext(
  actorId: string,
  _recipientId?: string
): ContextSnapshot {
  const store = loadStore();

  if (!(actorId in store.actors)) {
    const known = Object.keys(store.actors);
    throw new Error(
      `Actor '${actorId}' is not registered in the context store. Known actors: ${JSON.stringify(known)}`
    );
  }

  const actor = store.actors[actorId];

  return {
    actorId,
    actorRole: actor.role,
    partnerId: actor.partner_id,
    amountThresholdHbar: actor.amount_threshold_hbar,
    approvedRecipients: actor.approved_recipients,
    treasuryPosture: store.treasury.posture,
    enforceRecipientAllowlist: actor.enforce_recipient_allowlist,
  };
}

export function getTreasuryPosture(): TreasuryPosture {
  return loadStore().treasury.posture;
}

/**
 * Add a recipient account ID to the approved list for the given actor.
 * Persists the change to the store file so it survives process restarts.
 * No-ops silently if the recipient is already present.
 * Uses non-blocking async file writes via fs.promises.
 *
 * @throws {Error} If actorId is not registered.
 */
export async function addApprovedRecipient(actorId: string, recipientId: string): Promise<void> {
  const store = loadStore();

  if (!(actorId in store.actors)) {
    const known = Object.keys(store.actors);
    throw new Error(
      `Actor '${actorId}' is not registered. Known actors: ${JSON.stringify(known)}`
    );
  }

  const actor = store.actors[actorId];
  if (actor.approved_recipients.includes(recipientId)) return;

  actor.approved_recipients.push(recipientId);

  // Persist to file so the change survives restarts (non-blocking via fs.promises)
  const storePath = resolveStorePath();
  try {
    // Read raw file to preserve comments/_comment field, then replace actors block
    const raw = await fsPromises.readFile(storePath, "utf-8");
    const existing = JSON.parse(raw);
    existing.actors[actorId].approved_recipients = actor.approved_recipients;
    await fsPromises.writeFile(storePath, JSON.stringify(existing, null, 2) + "\n", "utf-8");
  } catch (err) {
    // File write failure is non-fatal — the in-memory change still takes effect,
    // but we log the error explicitly for observability
    console.error(
      `Failed to persist approved recipients for actor '${actorId}' to ${storePath}: ${err}`
    );
  }
}

/**
 * Return the current approved recipients list for an actor.
 * @throws {Error} If actorId is not registered.
 */
export function getApprovedRecipients(actorId: string): string[] {
  const store = loadStore();
  if (!(actorId in store.actors)) {
    throw new Error(`Actor '${actorId}' is not registered.`);
  }
  return [...store.actors[actorId].approved_recipients];
}
