/**
 * Context Engine — loads policy-relevant state for an Action.
 *
 * Store resolution order:
 *   1. Path given by the CONTEXT_STORE_PATH environment variable
 *   2. scripts/context_store.json  (default fixture location)
 *   3. Built-in in-memory fallback  (demo always works, even without a file)
 *
 * Milestone 2
 * -----------
 *   The store now models organisations and multi-role actors:
 *     - Organisation { id, name }
 *     - Actor { id, orgId, roles: Role[], ... }
 *   Legacy single-`role` actor records are still accepted and transparently
 *   widened to `roles: [role]` with orgId defaulting to a synthetic
 *   "org-legacy" so old fixtures keep working without modification.
 */

import { z } from "zod";
import fs from "fs";
import path from "path";
import { promises as fsPromises } from "fs";

// ── Enums ─────────────────────────────────────────────────────────────────────

export const TreasuryPostureSchema = z.enum(["NORMAL", "RESTRICTED", "FROZEN"]);
export type TreasuryPosture = z.infer<typeof TreasuryPostureSchema>;

/**
 * Actor role enum. Legacy roles (OPERATOR/PARTNER/ADMIN) are preserved so
 * existing fixtures continue to load; Milestone 2 adds APPROVER and AGENT.
 */
export const ActorRoleSchema = z.enum([
  "OPERATOR",
  "PARTNER",
  "ADMIN",
  "APPROVER",
  "AGENT",
]);
export type ActorRole = z.infer<typeof ActorRoleSchema>;

/** Default org id used when a fixture does not declare organisations. */
export const LEGACY_ORG_ID = "org-legacy";

// ── Organisation ──────────────────────────────────────────────────────────────

export const OrganisationSchema = z.object({
  id: z.string().min(1),
  name: z.string().default(""),
});
export type Organisation = z.infer<typeof OrganisationSchema>;

// ── ContextSnapshot ───────────────────────────────────────────────────────────

export const ContextSnapshotSchema = z.object({
  actorId: z.string(),
  /** Primary (legacy) role. Always populated; equals roles[0] when roles is non-empty. */
  actorRole: ActorRoleSchema,
  /**
   * Multi-role set. Optional on the schema because existing tests construct
   * ContextSnapshot literals without it; the loader always populates this.
   * Consumers should prefer `roles` and fall back to `[actorRole]` when
   * `roles` is absent or empty.
   */
  roles: z.array(ActorRoleSchema).optional(),
  /** Organisation this actor belongs to. Optional for the same reason as `roles`. */
  orgId: z.string().optional(),
  partnerId: z.string(),
  amountThresholdHbar: z.number(),
  approvedRecipients: z.array(z.string()).default([]),
  treasuryPosture: TreasuryPostureSchema.default("NORMAL"),
  enforceRecipientAllowlist: z.boolean().default(true),
});

export type ContextSnapshot = z.infer<typeof ContextSnapshotSchema>;

// Backwards-compatible alias
export type PolicyContext = ContextSnapshot;

/** Return the role set for a snapshot, collapsing the legacy single-role case. */
export function rolesOf(ctx: ContextSnapshot): ActorRole[] {
  if (ctx.roles && ctx.roles.length > 0) return ctx.roles;
  return [ctx.actorRole];
}

/** Return the org id for a snapshot, falling back to the legacy org when absent. */
export function orgOf(ctx: ContextSnapshot): string {
  return ctx.orgId ?? LEGACY_ORG_ID;
}

// ── Store schema (internal) ───────────────────────────────────────────────────

const ActorRecordSchema = z
  .object({
    // `role` is legacy (single string). `roles` is the new multi-role field.
    // At least one of the two must be present; see normaliseActor() below.
    role: ActorRoleSchema.optional(),
    roles: z.array(ActorRoleSchema).optional(),
    org_id: z.string().optional(),
    partner_id: z.string(),
    amount_threshold_hbar: z.number(),
    approved_recipients: z.array(z.string()).default([]),
    enforce_recipient_allowlist: z.boolean().default(true),
  })
  .refine(
    (v) => v.role !== undefined || (v.roles !== undefined && v.roles.length > 0),
    { message: "Actor record must declare either `role` or a non-empty `roles[]`." }
  );

const TreasuryRecordSchema = z.object({
  posture: TreasuryPostureSchema.default("NORMAL"),
});

const OrganisationRecordSchema = z.object({
  name: z.string().default(""),
});

const ContextStoreSchema = z.object({
  treasury: TreasuryRecordSchema.default({ posture: "NORMAL" }),
  organisations: z.record(z.string(), OrganisationRecordSchema).optional(),
  actors: z.record(z.string(), ActorRecordSchema).default({}),
});

type ContextStore = z.infer<typeof ContextStoreSchema>;
type ActorRecord = z.infer<typeof ActorRecordSchema>;

interface NormalisedActor {
  roles: ActorRole[];
  orgId: string;
  partnerId: string;
  amountThresholdHbar: number;
  approvedRecipients: string[];
  enforceRecipientAllowlist: boolean;
}

function normaliseActor(raw: ActorRecord): NormalisedActor {
  const roles: ActorRole[] =
    raw.roles && raw.roles.length > 0
      ? raw.roles
      : raw.role
        ? [raw.role]
        : [];
  return {
    roles,
    orgId: raw.org_id ?? LEGACY_ORG_ID,
    partnerId: raw.partner_id,
    amountThresholdHbar: raw.amount_threshold_hbar,
    approvedRecipients: raw.approved_recipients,
    enforceRecipientAllowlist: raw.enforce_recipient_allowlist,
  };
}

// ── In-memory fallback ────────────────────────────────────────────────────────

// Returns a fresh deep copy each time so mutations (e.g. setTreasuryPosture)
// don't bleed across calls to reloadStore() — critical for test isolation.
function buildFallbackStore(): ContextStore {
  return {
    treasury: { posture: "NORMAL" },
    organisations: {
      "org-alpha": { name: "Alpha Corp" },
      "org-beta": { name: "Beta Partners" },
      "org-internal": { name: "Internal Ops" },
    },
    actors: {
      "0.0.100": {
        role: "OPERATOR",
        roles: ["OPERATOR"],
        org_id: "org-alpha",
        partner_id: "partner-alpha",
        amount_threshold_hbar: 100.0,
        approved_recipients: ["0.0.800", "0.0.801"],
        enforce_recipient_allowlist: true,
      },
      "0.0.200": {
        role: "PARTNER",
        roles: ["PARTNER"],
        org_id: "org-beta",
        partner_id: "partner-beta",
        amount_threshold_hbar: 25.0,
        approved_recipients: ["0.0.800"],
        enforce_recipient_allowlist: true,
      },
      "0.0.300": {
        role: "ADMIN",
        roles: ["ADMIN", "APPROVER"],
        org_id: "org-internal",
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

  const actor = normaliseActor(store.actors[actorId]);
  if (actor.roles.length === 0) {
    throw new Error(
      `Actor '${actorId}' has no roles declared; this should have been caught by the schema.`
    );
  }

  return {
    actorId,
    actorRole: actor.roles[0],
    roles: actor.roles,
    orgId: actor.orgId,
    partnerId: actor.partnerId,
    amountThresholdHbar: actor.amountThresholdHbar,
    approvedRecipients: actor.approvedRecipients,
    treasuryPosture: store.treasury.posture,
    enforceRecipientAllowlist: actor.enforceRecipientAllowlist,
  };
}

export function getTreasuryPosture(): TreasuryPosture {
  return loadStore().treasury.posture;
}

/**
 * Look up the organisation for an actor without loading the full context.
 * Returns the legacy org id when the actor record does not declare one.
 *
 * @throws {Error} If actorId is not registered.
 */
export function getActorOrgId(actorId: string): string {
  const store = loadStore();
  if (!(actorId in store.actors)) {
    throw new Error(`Actor '${actorId}' is not registered.`);
  }
  return store.actors[actorId].org_id ?? LEGACY_ORG_ID;
}

/**
 * Look up roles for an actor without loading the full context.
 *
 * @throws {Error} If actorId is not registered.
 */
export function getActorRoles(actorId: string): ActorRole[] {
  const store = loadStore();
  if (!(actorId in store.actors)) {
    throw new Error(`Actor '${actorId}' is not registered.`);
  }
  return normaliseActor(store.actors[actorId]).roles;
}

/** True iff the given actor is registered in the current store. */
export function isKnownActor(actorId: string): boolean {
  return actorId in loadStore().actors;
}

/** List all registered organisations. */
export function listOrganisations(): Organisation[] {
  const store = loadStore();
  const orgs = store.organisations ?? {};
  return Object.entries(orgs).map(([id, rec]) => ({ id, name: rec.name }));
}

/**
 * Add a recipient account ID to the approved list for the given actor.
 * Persists the change to the store file so it survives process restarts.
 * Uses non-blocking async file writes via fs.promises.
 *
 * @returns `{ alreadyExisted: true }` when the recipient was already present (no-op),
 *          `{ alreadyExisted: false }` when it was newly added.
 * @throws {Error} If actorId is not registered.
 */
export async function addApprovedRecipient(
  actorId: string,
  recipientId: string
): Promise<{ alreadyExisted: boolean }> {
  const store = loadStore();

  if (!(actorId in store.actors)) {
    const known = Object.keys(store.actors);
    throw new Error(
      `Actor '${actorId}' is not registered. Known actors: ${JSON.stringify(known)}`
    );
  }

  const actor = store.actors[actorId];
  if (actor.approved_recipients.includes(recipientId)) return { alreadyExisted: true };

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

  return { alreadyExisted: false };
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
