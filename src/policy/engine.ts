/**
 * Policy / Clearance Engine — interpreter for the declarative Policy Catalogue.
 *
 * The engine is now a small, data-driven loop: it loads a LoadedPolicyCatalogue,
 * filters rules by action type (preserving declaration order), runs each rule's
 * named checker in sequence, and short-circuits on the first rule that fires.
 * Every PolicyResult carries the catalogue's version hash so replayers can
 * pin any decision to the exact rule set that produced it.
 *
 * Rule catalogue (v1 — migrated from the original hardcoded set)
 * --------------------------------------------------------------
 *   R001  RECIPIENT_PRESENT       deny              if recipient_id is blank
 *   R002  AMOUNT_VALID            deny              if amount_hbar is missing or <= 0
 *   R003  ACTOR_AUTHORISED        deny              if actor role not in permitted set
 *   R004  TREASURY_NOT_FROZEN     deny              if treasury posture is FROZEN
 *   R005  RECIPIENT_APPROVED      deny              if recipient not on actor's approved list
 *   R006  AMOUNT_WITHIN_LIMIT     approval_required if amount exceeds actor threshold
 *   R007  TREASURY_NOT_RESTRICTED manual_review     if treasury posture is RESTRICTED
 *
 * Migration note: the engine no longer defines rules. All rule metadata lives
 * in `policies/default.json`. The `Rxxx` constants below are kept as exports
 * for backwards compatibility with test files and downstream readers.
 */

import type { Action } from "../schemas/action";
import type { ContextSnapshot } from "../context/loader";
import type { PolicyResult } from "../schemas/policy";
import {
  loadCatalogue,
  rulesForActionType,
  type LoadedPolicyCatalogue,
  type PolicyRuleDefinition,
} from "./catalogue";
import { getChecker } from "./checkers";

// ── Rule ID constants ─────────────────────────────────────────────────────────
// These preserve the pre-catalogue format `"Rxxx:NAME"` so that any caller or
// test that compared against R001..R007 directly continues to work unchanged.

export const R001 = "R001:RECIPIENT_PRESENT";
export const R002 = "R002:AMOUNT_VALID";
export const R003 = "R003:ACTOR_AUTHORISED";
export const R004 = "R004:TREASURY_NOT_FROZEN";
export const R005 = "R005:RECIPIENT_APPROVED";
export const R006 = "R006:AMOUNT_WITHIN_LIMIT";
export const R007 = "R007:TREASURY_NOT_RESTRICTED";

// ── Rule ID formatter ─────────────────────────────────────────────────────────

/** Emit rule IDs in the cumulative `"Rxxx:NAME"` format used by audit events. */
function ruleLabel(rule: PolicyRuleDefinition): string {
  return `${rule.id}:${rule.name}`;
}

// ── Engine ────────────────────────────────────────────────────────────────────

/**
 * Apply the declarative clearance rule pipeline to an action.
 *
 * Evaluation order is the catalogue's declared order (filtered to rules whose
 * `appliesTo` includes this action's type). The first rule whose checker
 * fires short-circuits and its declared decision is returned. If every
 * applicable rule passes, the result is APPROVED with the full rule trace.
 *
 * A caller may pass an explicit catalogue (for testing or multi-tenant
 * evaluation); otherwise the default catalogue is loaded from disk.
 */
export function evaluatePolicy(
  action: Action,
  context: ContextSnapshot,
  catalogue: LoadedPolicyCatalogue = loadCatalogue()
): PolicyResult {
  const rules = rulesForActionType(catalogue, action.actionType);
  const evaluatedRules: string[] = [];

  for (const rule of rules) {
    evaluatedRules.push(ruleLabel(rule));
    const checker = getChecker(rule.check);
    if (checker.fires(action, context, rule)) {
      return {
        decision: rule.decision,
        denialReason: rule.denialReason,
        denialDetail: checker.detail(action, context, rule),
        evaluatedRules: [...evaluatedRules],
        policyVersion: catalogue.version,
      };
    }
  }

  return {
    decision: "APPROVED",
    denialReason: null,
    denialDetail: "",
    evaluatedRules,
    policyVersion: catalogue.version,
  };
}

/** Backwards-compatible alias. */
export const evaluate = evaluatePolicy;
