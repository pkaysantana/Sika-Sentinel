"use client";

import React from "react";
import type { PipelineResult } from "../../../../src/runtime/pipeline";
import type { ApprovalResult } from "../../types";

const HASHSCAN_TX  = "https://hashscan.io/testnet/transaction";
const HASHSCAN_SCH = "https://hashscan.io/testnet/schedule";

interface Props {
  result: PipelineResult;
  approvalResult: ApprovalResult | null;
}

function StageEvidence({ result, approvalResult }: Props) {
  const isBlocked = result.stage === "PARSE_BLOCKED";
  const decision = result.policyResult?.decision;
  const auditWritten = !!result.hcsTopicId && result.hcsSequenceNumber >= 0;
  const auditFailed =
    !auditWritten &&
    result.stage !== "PARSE_BLOCKED" &&
    result.stage !== "POLICY_EVALUATED" &&
    result.stage !== "ERROR";

  const displayOutcome = isBlocked ? "PARSE_BLOCKED" : (decision ?? "—");
  const outcomeClass =
    displayOutcome === "APPROVED"          ? "text-green-400"
    : displayOutcome === "DENIED"          ? "text-red-400"
    : displayOutcome === "APPROVAL_REQUIRED" ? "text-yellow-400"
    : displayOutcome === "MANUAL_REVIEW"   ? "text-orange-400"
    : displayOutcome === "PARSE_BLOCKED"   ? "text-amber-400"
    : "text-gray-500";

  return (
    <section className="swift-card p-4 space-y-3" style={{ borderColor: "rgba(180,122,255,0.15)" }}>
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 font-mono select-none">STAGE 4</span>
        <span className="text-sm font-bold" style={{ color: "#b47aff" }}>Evidence Layer</span>
        <span className="text-xs text-gray-500 font-mono">· Hedera Consensus Service</span>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs font-mono">
        <span className="text-gray-500">Outcome</span><span className={outcomeClass}>{displayOutcome}</span>
        <span className="text-gray-500">Audit written</span>
        <span className={auditWritten ? "text-green-400" : auditFailed ? "text-yellow-500" : "text-gray-600"}>
          {auditWritten ? "yes" : auditFailed ? "failed (non-fatal)" : "no"}
        </span>
        {result.hcsTopicId && (<>
          <span className="text-gray-500">Topic</span><span className="text-gray-300">{result.hcsTopicId}</span>
          <span className="text-gray-500">Sequence</span><span className="text-gray-300">#{result.hcsSequenceNumber}</span>
        </>)}
        {result.txId && (<>
          <span className="text-gray-500">Tx</span>
          <a href={`${HASHSCAN_TX}/${result.txId}`} target="_blank" rel="noopener noreferrer" className="text-[#5aa6ff] hover:underline break-all">{result.txId}</a>
        </>)}
        {result.scheduleId && (<>
          <span className="text-gray-500">Schedule</span>
          <a href={`${HASHSCAN_SCH}/${result.scheduleId}`} target="_blank" rel="noopener noreferrer" className="text-yellow-400 hover:underline break-all">{result.scheduleId}</a>
        </>)}
        {approvalResult && (<>
          <span className="text-gray-500">Approval</span><span className="text-green-400">{approvalResult.status}</span>
          {approvalResult.executionTxId && (<>
            <span className="text-gray-500">Transfer Tx</span>
            <a href={`${HASHSCAN_TX}/${approvalResult.executionTxId}`} target="_blank" rel="noopener noreferrer" className="text-green-400 hover:underline break-all">{approvalResult.executionTxId}</a>
          </>)}
          <span className="text-gray-500">Sign Tx</span>
          <a href={`${HASHSCAN_TX}/${approvalResult.signTxId}`} target="_blank" rel="noopener noreferrer" className="text-[#5aa6ff] hover:underline break-all">{approvalResult.signTxId}</a>
          {approvalResult.hcsTopicId && (<>
            <span className="text-gray-500">Approval audit</span>
            <span className="text-gray-300">#{approvalResult.hcsSequenceNumber}</span>
          </>)}
        </>)}
      </div>
    </section>
  );
}

export default React.memo(StageEvidence);
