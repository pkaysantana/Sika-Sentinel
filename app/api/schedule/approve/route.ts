/**
 * POST /api/schedule/approve
 * Body: { scheduleId: string }
 *
 * Submits a secondary signature (ScheduleSignTransaction) to approve a
 * pending scheduled transfer. Records the approval to the HCS audit trail.
 */

import { NextRequest, NextResponse } from "next/server";
import { record as recordAudit } from "../../../../src/audit/trail";
import type { Action } from "../../../../src/schemas/action";
import { resolveCaller } from "../../../../src/auth/middleware";

export async function POST(req: NextRequest) {
  // Resolve caller for audit attribution. Non-fatal if resolution fails —
  // the approval itself is not gated on caller identity at this endpoint
  // (the schedule already went through auth at /api/run). We still record
  // who signed it when a valid caller is present.
  const callerResult = resolveCaller(req);
  const callerRef = callerResult.ok
    ? { id: callerResult.caller.id, kind: callerResult.caller.kind }
    : null;

  let body: { scheduleId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { scheduleId } = body;
  if (!scheduleId || typeof scheduleId !== "string") {
    return NextResponse.json(
      { error: "scheduleId is required" },
      { status: 400 }
    );
  }

  // Basic Hedera entity ID format validation
  if (!/^\d+\.\d+\.\d+$/.test(scheduleId.trim())) {
    return NextResponse.json(
      {
        error: `'${scheduleId}' is not a valid Hedera schedule ID (expected shard.realm.num)`,
      },
      { status: 400 }
    );
  }

  try {
    // Dynamic import — same pattern as pipeline.ts to avoid Next.js bundling issues
    const { approveScheduledTransfer } = await import(
      "../../../../src/hedera/schedule"
    );

    const result = await approveScheduledTransfer(scheduleId.trim());

    // Record the approval as a separate audit event so the lifecycle is visible.
    // Use a synthetic action so the audit schema is satisfied.
    const approvalAction: Action = {
      correlationId: `approval-${scheduleId.trim()}-${Date.now()}`,
      actionType: "HBAR_TRANSFER",
      actorId: process.env.HEDERA_APPROVER_ID || process.env.HEDERA_TREASURY_ID || "",
      recipientId: "",
      amountHbar: 0,
      rawInstruction: `Secondary approval for schedule ${scheduleId.trim()}`,
      memo: "",
    };

    // The secondary-approval path does not re-run the policy engine — the
    // original decision was already pinned to a catalogue version and lives
    // on the scheduled action's audit trail. This synthetic result records
    // the signing event itself, so policyVersion is intentionally blank.
    const approvalPolicyResult = {
      decision: "APPROVED" as const,
      denialReason: null,
      denialDetail: `Schedule ${scheduleId.trim()} approved via ScheduleSignTransaction`,
      evaluatedRules: [] as string[],
      policyVersion: "",
    };

    let hcsTopicId = "";
    let hcsSequenceNumber = -1;
    try {
      const auditRecord = await recordAudit({
        action: approvalAction,
        policyResult: approvalPolicyResult,
        txId: result.signTxId,
        scheduleId: scheduleId.trim(),
        caller: callerRef,
      });
      hcsTopicId = auditRecord.topicId;
      hcsSequenceNumber = auditRecord.sequenceNumber;
    } catch {
      // Audit failure is non-fatal
    }

    return NextResponse.json({
      ...result,
      hcsTopicId,
      hcsSequenceNumber,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
