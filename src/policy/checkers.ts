/**
 * Checker registry — named predicate primitives referenced by Policy Catalogue rules.
 *
 * Each checker has two responsibilities:
 *   fires()  — decides whether the rule fires and, if so, its semantic class.
 *   detail() — renders the `denialDetail` string shown to users and stored
 *              in the audit event.
 *
 * The catalogue references checkers symbolically by name (`check: "R001"`),
 * so the declarative document stays small and auditable while the actual
 * predicate logic remains TypeScript code under version control.
 *
 * Adding a new primitive is a two-step, type-checked operation:
 *   1. Add its implementation to CHECKERS below.
 *   2. Add its name to CHECKER_NAMES (used by the catalogue schema's enum).
 * Any rule catalogue referencing an unknown name will fail schema parsing.
 *
 * CheckerOutcome (multi-state decisions)
 * --------------------------------------
 *   Financial-policy decisions are inherently multi-state: a rule may
 *   hard-deny, route to human review, or explicitly allow. `fires()` now
 *   returns a `CheckerOutcome`:
 *
 *     null    — rule does not apply / passes
 *     "DENY"  — rule triggers as a hard denial
 *     "REVIEW" — rule triggers requesting human review / secondary signature
 *     "ALLOW" — rule explicitly permits (reserved; not used by the default
 *               catalogue yet — future composition hook for positive overrides)
 *
 *   The authoritative public Decision on the emitted PolicyResult still
 *   comes from the rule's catalogue `decision` field; CheckerOutcome makes
 *   each primitive's semantic class explicit at the TS level, removes the
 *   "everything-is-a-boolean-deny" ambiguity, and is the seed for future
 *   priority ordering / aggregation strategies. No rule authored today
 *   depends on anything beyond the null/non-null split.
 *
 * Milestone 2 — multi-role + org
 * ------------------------------
 *   ACTOR_AUTHORISED now evaluates against the full role set `rolesOf(ctx)`
 *   rather than a single `ctx.actorRole`, so actors carrying multiple roles
 *   (e.g. ADMIN + APPROVER) are authorised by any matching role.
 *
 *   SAME_ORG_REQUIRED is the first org-aware rule: when the recipient of an
 *   HBAR_TRANSFER is a known actor in the context store, both parties must
 *   belong to the same organisation. External recipients (unknown to the
 *   store) pass through by default; opt-in tightening is available via the
 *   `allowExternal: false` rule parameter.
 */

import type { Action, ActionType } from "../schemas/action";
import {
  rolesOf,
  orgOf,
  isKnownActor,
  getActorOrgId,
  type ActorRole,
  type ContextSnapshot,
} from "../context/loader";
import type { PolicyRuleDefinition } from "./catalogue";

// ── Checker contract ──────────────────────────────────────────────────────────

/**
 * The semantic class of a firing rule. `null` means the rule did not fire.
 * Today the engine only cares about the null/non-null split; the explicit
 * DENY / REVIEW / ALLOW tags are kept on each checker so that future
 * composition (priority ordering, structured explanations) has a solid
 * foundation instead of re-inferring intent from the rule's public decision.
 */
export type CheckerOutcome = "DENY" | "REVIEW" | "ALLOW" | null;

export interface Checker {
  /**
   * Returns the outcome class when this rule fires, or `null` when it
   * passes. Callers should treat any non-null value as "triggered" and
   * defer to the rule's catalogue `decision` for the public PolicyResult.
   */
  fires: (action: Action, context: ContextSnapshot, rule: PolicyRuleDefinition) => CheckerOutcome;
  /** Rendered `denialDetail` when the rule fires. Never called if fires() is null. */
  detail: (action: Action, context: ContextSnapshot, rule: PolicyRuleDefinition) => string;
}

// Action types that move value. Used by checkers that must not evaluate for
// non-transfer actions (e.g. balance queries must not be blocked by R001).
const TRANSFER_TYPES: ReadonlySet<ActionType> = new Set<ActionType>(["HBAR_TRANSFER"]);

// ── Helpers ───────────────────────────────────────────────────────────────────

function readStringArrayParam(
  rule: PolicyRuleDefinition,
  key: string
): string[] | null {
  const params = rule.params;
  if (!params || !(key in params)) return null;
  const raw = params[key];
  if (!Array.isArray(raw)) return null;
  return raw.every((v) => typeof v === "string") ? (raw as string[]) : null;
}

function readBoolParam(rule: PolicyRuleDefinition, key: string): boolean | null {
  const params = rule.params;
  if (!params || !(key in params)) return null;
  const raw = params[key];
  return typeof raw === "boolean" ? raw : null;
}

function hasRecipient(action: Action): boolean {
  return !!action.recipientId && !!action.recipientId.trim();
}

// ── Primitive implementations ─────────────────────────────────────────────────

const RECIPIENT_PRESENT: Checker = {
  fires: (action) =>
    TRANSFER_TYPES.has(action.actionType) && !hasRecipient(action) ? "DENY" : null,
  detail: () => "A recipient account ID is required for transfer actions.",
};

const AMOUNT_VALID: Checker = {
  fires: (action) =>
    TRANSFER_TYPES.has(action.actionType) && action.amountHbar <= 0 ? "DENY" : null,
  detail: (action) =>
    `Transfer amount must be greater than zero (received: ${action.amountHbar} HBAR).`,
};

const ACTOR_AUTHORISED: Checker = {
  fires: (_action, context, rule) => {
    const permitted = readStringArrayParam(rule, "permittedRoles");
    if (permitted === null) {
      throw new Error(
        `ACTOR_AUTHORISED checker requires rule.params.permittedRoles (string[]); rule '${rule.id}' has: ${JSON.stringify(rule.params)}`
      );
    }
    // Positive form: an actor is authorised iff any of their roles is in
    // the permitted set. rolesOf() collapses legacy single-role snapshots
    // to [actorRole], so old fixtures still evaluate correctly.
    const actorRoles = rolesOf(context);
    const isAuthorised = actorRoles.some((r) => permitted.includes(r as ActorRole));
    return isAuthorised ? null : "DENY";
  },
  detail: (_action, context, rule) => {
    const permitted = readStringArrayParam(rule, "permittedRoles") ?? [];
    const actorRoles = rolesOf(context);
    return (
      `Actor '${context.actorId}' has roles [${actorRoles.join(", ")}] ` +
      `but none are permitted. Permitted roles: ${permitted.join(", ")}.`
    );
  },
};

const TREASURY_NOT_FROZEN: Checker = {
  fires: (action, context) =>
    TRANSFER_TYPES.has(action.actionType) && context.treasuryPosture === "FROZEN"
      ? "DENY"
      : null,
  detail: () =>
    "Treasury is currently FROZEN. All transfers are suspended until the treasury posture is restored to NORMAL.",
};

const RECIPIENT_APPROVED: Checker = {
  fires: (action, context) => {
    if (!TRANSFER_TYPES.has(action.actionType)) return null;
    if (!context.enforceRecipientAllowlist) return null;
    // Orthogonality: empty/blank recipient is RECIPIENT_PRESENT's concern,
    // not ours. Returning null here prevents a misleading "not on approved
    // list" denial when the real problem is a missing recipient.
    if (!hasRecipient(action)) return null;
    return context.approvedRecipients.includes(action.recipientId) ? null : "DENY";
  },
  detail: (action, context) =>
    `Recipient '${action.recipientId}' is not on the approved list for actor '${context.actorId}'. ` +
    `Approved: ${JSON.stringify(context.approvedRecipients)}.`,
};

const AMOUNT_WITHIN_LIMIT: Checker = {
  fires: (action, context) =>
    TRANSFER_TYPES.has(action.actionType) && action.amountHbar > context.amountThresholdHbar
      ? "REVIEW"
      : null,
  detail: (action, context) =>
    `Requested amount ${action.amountHbar} HBAR exceeds the threshold of ${context.amountThresholdHbar} HBAR ` +
    `for actor '${context.actorId}'. Human approval is required before execution.`,
};

const TREASURY_NOT_RESTRICTED: Checker = {
  fires: (action, context) =>
    TRANSFER_TYPES.has(action.actionType) && context.treasuryPosture === "RESTRICTED"
      ? "REVIEW"
      : null,
  detail: () =>
    "Treasury is currently RESTRICTED. This transfer has been routed to the compliance queue for manual review before execution.",
};

/**
 * SAME_ORG_REQUIRED — the first org-aware rule.
 *
 * Fires for transfer actions whose recipient is a **known actor** in the
 * context store but belongs to a different organisation than the initiating
 * actor. Unknown (external) recipients are treated as out-of-scope for this
 * rule by default, so legitimate transfers to external Hedera accounts are
 * not blocked accidentally.
 *
 * Optional params:
 *   `allowExternal` (default true) — when false, transfers to unknown
 *     recipients are also rejected. Useful for tightly-scoped treasuries
 *     that should never send outside the organisation store.
 */
const SAME_ORG_REQUIRED: Checker = {
  fires: (action, context, rule) => {
    if (!TRANSFER_TYPES.has(action.actionType)) return null;
    if (!hasRecipient(action)) return null;

    const actorOrg = orgOf(context);

    if (!isKnownActor(action.recipientId)) {
      // Defaulting explicitly so the behaviour matches the JSDoc and the
      // catalogue's published contract without relying on truthy coercion.
      const allowExternal = readBoolParam(rule, "allowExternal") ?? true;
      return allowExternal ? null : "DENY";
    }

    const recipientOrg = getActorOrgId(action.recipientId);
    return recipientOrg === actorOrg ? null : "DENY";
  },
  detail: (action, context) => {
    const actorOrg = orgOf(context);
    if (!isKnownActor(action.recipientId)) {
      return (
        `Recipient '${action.recipientId}' is external to the organisation store and ` +
        `this rule is configured to reject external transfers.`
      );
    }
    const recipientOrg = getActorOrgId(action.recipientId);
    return (
      `Cross-organisation transfer rejected: actor '${context.actorId}' is in org ` +
      `'${actorOrg}' but recipient '${action.recipientId}' is in org '${recipientOrg}'.`
    );
  },
};

// ── Registry ──────────────────────────────────────────────────────────────────

/**
 * The fixed list of checker names is the source of truth for the catalogue
 * schema's `check` enum. Declared `as const` so the Zod schema in
 * `catalogue.ts` can narrow it to a string-literal union without runtime
 * duplication.
 */
export const CHECKER_NAMES = [
  "RECIPIENT_PRESENT",
  "AMOUNT_VALID",
  "ACTOR_AUTHORISED",
  "TREASURY_NOT_FROZEN",
  "RECIPIENT_APPROVED",
  "AMOUNT_WITHIN_LIMIT",
  "TREASURY_NOT_RESTRICTED",
  "SAME_ORG_REQUIRED",
] as const;

export type CheckerName = typeof CHECKER_NAMES[number];

export const CHECKERS: Record<CheckerName, Checker> = {
  RECIPIENT_PRESENT,
  AMOUNT_VALID,
  ACTOR_AUTHORISED,
  TREASURY_NOT_FROZEN,
  RECIPIENT_APPROVED,
  AMOUNT_WITHIN_LIMIT,
  TREASURY_NOT_RESTRICTED,
  SAME_ORG_REQUIRED,
};

export function getChecker(name: CheckerName): Checker {
  const checker = CHECKERS[name];
  if (!checker) {
    throw new Error(`Unknown checker: '${name}'. Known: ${CHECKER_NAMES.join(", ")}.`);
  }
  return checker;
}
