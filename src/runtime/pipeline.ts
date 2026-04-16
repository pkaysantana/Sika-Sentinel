/**
 * Runtime Pipeline — orchestration layer for Sika Sentinel.
 *
 * runPolicyOnly — context + policy decision (no Hedera calls)
 * run           — full pipeline: policy + execution + HCS audit
 */

import type { Action } from "../schemas/action";
import type { PolicyResult } from "../schemas/policy";
import type { ContextSnapshot } from "../context/loader";
import type { AgentContext } from "../schemas/audit";
import type { CallerReference } from "../auth/schemas";
import { loadContext } from "../context/loader";
import { evaluatePolicy } from "../policy/engine";
import { executeHbarTransfer } from "../hedera/transfer";
import { queryBalance } from "../hedera/balance";
import { record as recordAudit } from "../audit/trail";

// ── Pipeline stage ────────────────────────────────────────────────────────────

export type PipelineStage =
  | "PARSE_BLOCKED"
  | "POLICY_EVALUATED"
  | "SCHEDULED"
  | "EXECUTED"
  | "AUDITED"
  | "ERROR";

// ── Pipeline result ───────────────────────────────────────────────────────────

export interface PipelineResult {
  action: Action;
  context: ContextSnapshot | null;
  policyResult: PolicyResult | null;
  stage: PipelineStage;
  timestamp: string;  // ISO 8601

  // Phase 2 — Hedera execution
  txId: string;
  balanceHbar: number | null;   // populated for CHECK_BALANCE actions
  scheduleId: string;           // populated for APPROVAL_REQUIRED scheduled transfers
  scheduleError: string;        // populated if schedule creation failed

  // Phase 2 — HCS audit
  hcsTopicId: string;
  hcsSequenceNumber: number;
  /**
   * Audit durability state.
   *   "written"       — successfully shipped to HCS.
   *   "queued"        — durably stored locally; HCS submission pending
   *                     (worker will retry with backoff).
   *   "failed_terminal" — either outbox enqueue failed (disk/permission error)
   *                     OR the entry exhausted its retry budget. Execution
   *                     happened but durable audit evidence is at risk.
   */
  auditStatus: "written" | "queued" | "failed_terminal";

  /**
   * LLM parse status from the intent parser phase.
   *   "ok"       — LLM was not needed or succeeded.
   *   "fallback" — LLM failed; heuristic fallback was used; result may proceed.
   *   "failed"   — LLM failed AND heuristic result is also blocked.
   */
  llmStatus: "ok" | "fallback" | "failed";

  // Error path
  error: string;
}

function now(): string {
  return new Date().toISOString();
}

/** True only when policy returned APPROVED */
export function isApproved(result: PipelineResult): boolean {
  return result.policyResult?.decision === "APPROVED";
}

/** Human-readable one-word label for UI display */
export function decisionLabel(result: PipelineResult): string {
  if (result.stage === "ERROR") return "ERROR";
  if (!result.policyResult) return "UNKNOWN";
  return result.policyResult.decision;
}

// ── Phase 1: policy-only pipeline ────────────────────────────────────────────

/**
 * Load context and evaluate policy. No Hedera calls.
 * Returns stage=ERROR if actor is unknown; stage=POLICY_EVALUATED otherwise.
 */
export function runPolicyOnly(action: Action): PipelineResult {
  let context: ContextSnapshot;
  try {
    context = loadContext(action.actorId, action.recipientId);
  } catch (err) {
    return {
      action,
      context: null,
      policyResult: null,
      stage: "ERROR",
      timestamp: now(),
      txId: "",
      balanceHbar: null,
      scheduleId: "",
      scheduleError: "",
      hcsTopicId: "",
      hcsSequenceNumber: -1,
      auditStatus: "failed_terminal",
      llmStatus: "ok",
      error: String(err),
    };
  }

  const policyResult = evaluatePolicy(action, context);

  return {
    action,
    context,
    policyResult,
    stage: "POLICY_EVALUATED",
    timestamp: now(),
    txId: "",
    balanceHbar: null,
    scheduleId: "",
    scheduleError: "",
    hcsTopicId: "",
    hcsSequenceNumber: -1,
    auditStatus: "failed_terminal",
    llmStatus: "ok",
    error: "",
  };
}

// ── Phase 2: full pipeline ────────────────────────────────────────────────────

/**
 * Full pipeline: policy evaluation → (if APPROVED) Hedera transfer → HCS audit.
 * The HCS audit is written for ALL outcomes (approved and denied).
 *
 * Pass agentContext when the action originated from the Intent Parser Agent so
 * the audit event records what the parser believed about the instruction.
 *
 * Pass caller when the request was authenticated — it flows into the audit
 * record so replayers can see who submitted the request alongside the actor
 * whose authority was exercised.
 */
export async function run(
  action: Action,
  agentContext?: AgentContext,
  caller?: CallerReference,
  llmStatus?: "ok" | "fallback" | "failed"
): Promise<PipelineResult> {
  // Phase 1
  const phase1 = runPolicyOnly(action);
  if (phase1.stage === "ERROR") return phase1;

  const { context, policyResult } = phase1;

  let txId = "";
  let balanceHbar: number | null = null;
  let scheduleId = "";
  let scheduleError = "";
  let stage: PipelineStage = "POLICY_EVALUATED";
  let auditStatus: "written" | "queued" | "failed_terminal" = "failed_terminal";
  const resolvedLlmStatus = llmStatus ?? "ok";

  const decision = policyResult!.decision;

  if (decision === "APPROVED") {
    if (action.actionType === "HBAR_TRANSFER") {
      // Execute transfer
      try {
        const transferResult = await executeHbarTransfer(action);
        txId = transferResult.txId;
        stage = "EXECUTED";
      } catch (err) {
        return {
          ...phase1,
          balanceHbar: null,
          scheduleId: "",
          scheduleError: "",
          stage: "ERROR",
          auditStatus: "failed_terminal",
          llmStatus: resolvedLlmStatus,
          error: `Transfer failed: ${err}`,
        };
      }
    } else if (action.actionType === "CHECK_BALANCE") {
      // Execute balance query
      try {
        const balanceResult = await queryBalance(action);
        balanceHbar = balanceResult.balanceHbar;
        stage = "EXECUTED";
      } catch (err) {
        return {
          ...phase1,
          balanceHbar: null,
          scheduleId: "",
          scheduleError: "",
          stage: "ERROR",
          auditStatus: "failed_terminal",
          llmStatus: resolvedLlmStatus,
          error: `Balance query failed: ${err}`,
        };
      }
    }
  } else if (decision === "APPROVAL_REQUIRED" && action.actionType === "HBAR_TRANSFER") {
    // Create a scheduled transaction — funds are NOT released until a
    // second signer submits a ScheduleSignTransaction.
    try {
      // Dynamic import to avoid static module resolution issues in Next.js
      const { createScheduledTransfer } = await import("../hedera/schedule");
      const schedResult = await createScheduledTransfer(action);
      scheduleId = schedResult.scheduleId;
      stage = "SCHEDULED";
    } catch (err) {
      // Scheduled tx creation failed — explicitly log the error
      scheduleError = String(err);
      console.error(`Schedule creation failed for action ${action.correlationId}: ${err}`);
      // Fall through to audit with stage still POLICY_EVALUATED so it's clear no schedule was created
    }
  }

  // Write audit record for all outcomes (approved, denied, scheduled, etc.)
  let hcsTopicId = "";
  let hcsSequenceNumber = -1;
  try {
    const auditRecord = await recordAudit({
      action,
      policyResult: policyResult!,
      txId,
      agentContext,
      scheduleId,
      caller: caller ?? null,
    });
    hcsTopicId = auditRecord.topicId;
    hcsSequenceNumber = auditRecord.sequenceNumber;
    auditStatus = auditRecord.state;  // "queued" or "written"
    if (stage !== "SCHEDULED") stage = "AUDITED";
  } catch (err) {
    // Outbox append itself failed — durable evidence could not be stored.
    // This is a loud failure: we log it and surface auditStatus="failed_terminal",
    // but do not override stage to ERROR since execution may have completed.
    auditStatus = "failed_terminal";
    console.error(`Audit outbox enqueue failed for action ${action.correlationId}: ${err}`);
  }

  return {
    action,
    context,
    policyResult,
    stage,
    timestamp: now(),
    txId,
    balanceHbar,
    scheduleId,
    scheduleError,
    hcsTopicId,
    hcsSequenceNumber,
    auditStatus,
    llmStatus: resolvedLlmStatus,
    error: "",
  };
}
