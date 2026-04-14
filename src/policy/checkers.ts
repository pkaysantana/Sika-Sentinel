/**
 * Checker registry — named predicate primitives referenced by Policy Catalogue rules.
 *
 * Each checker has two responsibilities:
 *   fires()  — decides whether the rule it is attached to should trigger.
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
 */

import type { Action, ActionType } from "../schemas/action";
import type { ActorRole, ContextSnapshot } from "../context/loader";
import type { PolicyRuleDefinition } from "./catalogue";

// ── Checker contract ──────────────────────────────────────────────────────────

export interface Checker {
  /** True iff this rule's predicate fires for the given action/context. */
  fires: (action: Action, context: ContextSnapshot, rule: PolicyRuleDefinition) => boolean;
  /** Rendered `denialDetail` when the rule fires. Never called if fires() is false. */
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

// ── Primitive implementations ─────────────────────────────────────────────────

const RECIPIENT_PRESENT: Checker = {
  fires: (action) =>
    TRANSFER_TYPES.has(action.actionType) &&
    (!action.recipientId || !action.recipientId.trim()),
  detail: () => "A recipient account ID is required for transfer actions.",
};

const AMOUNT_VALID: Checker = {
  fires: (action) => TRANSFER_TYPES.has(action.actionType) && action.amountHbar <= 0,
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
    return !permitted.includes(context.actorRole as ActorRole);
  },
  detail: (_action, context, rule) => {
    const permitted = readStringArrayParam(rule, "permittedRoles") ?? [];
    return (
      `Actor '${context.actorId}' has role '${context.actorRole}' which is not permitted. ` +
      `Permitted roles: ${permitted.join(", ")}.`
    );
  },
};

const TREASURY_NOT_FROZEN: Checker = {
  fires: (action, context) =>
    TRANSFER_TYPES.has(action.actionType) && context.treasuryPosture === "FROZEN",
  detail: () =>
    "Treasury is currently FROZEN. All transfers are suspended until the treasury posture is restored to NORMAL.",
};

const RECIPIENT_APPROVED: Checker = {
  fires: (action, context) => {
    if (!TRANSFER_TYPES.has(action.actionType)) return false;
    if (!context.enforceRecipientAllowlist) return false;
    return !context.approvedRecipients.includes(action.recipientId);
  },
  detail: (action, context) =>
    `Recipient '${action.recipientId}' is not on the approved list for actor '${context.actorId}'. ` +
    `Approved: ${JSON.stringify(context.approvedRecipients)}.`,
};

const AMOUNT_WITHIN_LIMIT: Checker = {
  fires: (action, context) =>
    TRANSFER_TYPES.has(action.actionType) && action.amountHbar > context.amountThresholdHbar,
  detail: (action, context) =>
    `Requested amount ${action.amountHbar} HBAR exceeds the threshold of ${context.amountThresholdHbar} HBAR ` +
    `for actor '${context.actorId}'. Human approval is required before execution.`,
};

const TREASURY_NOT_RESTRICTED: Checker = {
  fires: (action, context) =>
    TRANSFER_TYPES.has(action.actionType) && context.treasuryPosture === "RESTRICTED",
  detail: () =>
    "Treasury is currently RESTRICTED. This transfer has been routed to the compliance queue for manual review before execution.",
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
};

export function getChecker(name: CheckerName): Checker {
  const checker = CHECKERS[name];
  if (!checker) {
    throw new Error(`Unknown checker: '${name}'. Known: ${CHECKER_NAMES.join(", ")}.`);
  }
  return checker;
}
