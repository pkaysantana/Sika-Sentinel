/**
 * PolicyResult — the output of the clearance engine.
 *
 * Carries the decision and, for non-approved outcomes, a structured reason
 * that is safe to surface in the demo UI and embedded in the HCS audit trail.
 */

import { z } from "zod";

export const DecisionSchema = z.enum([
  "APPROVED",
  "DENIED",
  "APPROVAL_REQUIRED",
  "MANUAL_REVIEW",
  "ESCALATED", // backwards-compat alias; prefer APPROVAL_REQUIRED
]);
export type Decision = z.infer<typeof DecisionSchema>;

export const DenialReasonSchema = z.enum([
  // Input validation
  "MISSING_RECIPIENT",
  "INVALID_AMOUNT",
  // Actor authorisation
  "ACTOR_NOT_AUTHORISED",
  // Treasury posture
  "TREASURY_FROZEN",
  "TREASURY_RESTRICTED",
  // Recipient allowlist
  "RECIPIENT_NOT_APPROVED",
  // Amount threshold
  "AMOUNT_EXCEEDS_THRESHOLD",
]);
export type DenialReason = z.infer<typeof DenialReasonSchema>;

export const PolicyResultSchema = z.object({
  decision: DecisionSchema,
  denialReason: DenialReasonSchema.nullable().default(null),
  denialDetail: z.string().default(""),
  evaluatedRules: z.array(z.string()).default([]), // rule IDs checked, in evaluation order
  /**
   * SHA-256 hash of the policy catalogue that produced this result
   * (`sha256:<hex>`). Attached for governance: every decision is pinned to
   * the exact rule document that was in force when it was made.
   *
   * Defaults to "" so pre-catalogue audit events still parse.
   */
  policyVersion: z.string().default(""),
});

export type PolicyResult = z.infer<typeof PolicyResultSchema>;
