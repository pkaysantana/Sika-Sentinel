/**
 * Audit Trail — builds AuditMessages, enqueues them durably via the audit
 * outbox, and (best-effort) ships them to HCS.
 *
 * Durability contract
 * -------------------
 *   record() **always** succeeds if the audit event is durably queued.
 *   It only throws when the outbox backend itself refuses the append —
 *   e.g. disk full, permission denied. That is a real failure and the
 *   pipeline treats it as stage=ERROR.
 *
 *   A transient HCS failure is NOT a record() error: the entry stays in
 *   the outbox with state="queued" and record() returns normally with
 *   `state: "queued"`. A later drain() (boot / cron) will retry it.
 *
 *   This is the invariant the milestone requires: execution never
 *   proceeds without at least a durably-queued audit event. Even if HCS
 *   is down for hours, the evidence lives on disk the moment the caller
 *   got a 200 back.
 *
 * Signature change from 1A
 * ------------------------
 *   record() used to take positional params. It now takes an options
 *   object because callers need to pass the authenticated caller
 *   reference alongside the existing action / policy / tx / schedule
 *   fields. See RecordInput below.
 */

import type { Action } from "../schemas/action";
import type { PolicyResult } from "../schemas/policy";
import type { AuditMessage, AgentContext } from "../schemas/audit";
import type { CallerReference } from "../auth/schemas";
import { fetchMessages, submitMessage } from "../hedera/hcs";
import {
  getDefaultOutbox,
  type Outbox,
  type Shipper,
} from "./outbox";

// ── Input / output shapes ────────────────────────────────────────────────────

export interface RecordInput {
  action: Action;
  policyResult: PolicyResult;
  /** Hedera tx id once executed, empty string otherwise. */
  txId?: string;
  /** Parser agent context, when the action came from an instruction. */
  agentContext?: AgentContext;
  /** Schedule id for APPROVAL_REQUIRED scheduled transfers. */
  scheduleId?: string;
  /** Authenticated caller that submitted the request. null for internal. */
  caller?: CallerReference;
}

/**
 * Outcome of a successful record() call.
 *
 *   state = "written" → the event has been shipped to HCS; topicId and
 *                       sequenceNumber reflect the confirmed receipt.
 *   state = "queued"  → the event is durable on disk but HCS submission
 *                       has not yet succeeded. topicId/sequenceNumber are
 *                       empty. A later drain will retry.
 */
export interface RecordResult {
  message: AuditMessage;
  state: "queued" | "written";
  entryId: string;
  topicId: string;
  sequenceNumber: number;
}

// ── Record ────────────────────────────────────────────────────────────────────

/** Internal: build the in-memory AuditMessage from a RecordInput. */
function buildMessage(input: RecordInput): AuditMessage {
  return {
    correlationId: input.action.correlationId,
    timestamp: new Date().toISOString(),
    action: input.action,
    policyResult: input.policyResult,
    txId: input.txId ?? "",
    scheduleId: input.scheduleId ?? "",
    topicId: "",
    sequenceNumber: -1,
    payloadHash: "",
    policyVersion: input.policyResult.policyVersion ?? "",
    caller: input.caller ?? null,
    ...(input.agentContext !== undefined ? { agentContext: input.agentContext } : {}),
  };
}

/**
 * Build an AuditMessage, durably enqueue it, and attempt to ship it to HCS.
 *
 * Behaviour:
 *   1. Build the message.
 *   2. Outbox.enqueue — throws if the local journal write fails. This is
 *      propagated so the pipeline treats it as a loud ERROR.
 *   3. Outbox.ship — best effort; never throws. On success, state goes to
 *      "written"; on failure the entry stays "queued" and we still return
 *      successfully.
 *
 * Tests can inject a specific outbox and/or shipper via the second arg.
 */
export async function record(
  input: RecordInput,
  deps: { outbox?: Outbox; shipper?: Shipper } = {}
): Promise<RecordResult> {
  const outbox = deps.outbox ?? getDefaultOutbox();
  const shipper = deps.shipper ?? submitMessage;

  const message = buildMessage(input);
  const queued = outbox.enqueue(message);

  const shipResult = await outbox.ship(queued.id, shipper);

  if (shipResult.ok) {
    return {
      message: shipResult.entry.message,
      state: "written",
      entryId: shipResult.entry.id,
      topicId: shipResult.entry.topicId,
      sequenceNumber: shipResult.entry.sequenceNumber,
    };
  }

  // Ship failed but enqueue succeeded — the durability invariant holds.
  // Return the original (not-yet-shipped) message so the caller's response
  // can reflect "queued, not yet on HCS". topicId / sequenceNumber stay
  // empty until a later drain() successfully ships the entry.
  return {
    message: shipResult.entry.message,
    state: "queued",
    entryId: shipResult.entry.id,
    topicId: "",
    sequenceNumber: -1,
  };
}

// ── Replay ────────────────────────────────────────────────────────────────────

/**
 * Fetch ordered AuditMessages from Mirror Node for the configured HCS topic.
 * Used by the UI audit replay panel. Unrelated to the outbox — this path
 * reads from Hedera itself.
 */
export async function replay(limit = 50): Promise<AuditMessage[]> {
  const topicId = process.env.HCS_TOPIC_ID;
  if (!topicId) {
    throw new Error(
      "HCS_TOPIC_ID is not set. Run scripts/createTopic.ts to create a topic."
    );
  }
  return fetchMessages(topicId, limit);
}
