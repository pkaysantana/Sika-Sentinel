"use client";

import React from "react";
import type { PipelineResult } from "../../../../src/runtime/pipeline";
import type { DecisionBadge, ApprovalResult } from "../../types";

const HASHSCAN_BASE = "https://hashscan.io/testnet/transaction";

interface Props {
  result: PipelineResult;
  badge: DecisionBadge | null;
  approvalResult: ApprovalResult | null;
  approvalLoading: boolean;
  approvalError: string;
  onApproveSchedule: (scheduleId: string) => void;
}

function StageClearing({
  result,
  badge,
  approvalResult,
  approvalLoading,
  approvalError,
  onApproveSchedule,
}: Props) {
  const isBlocked = result.stage === "PARSE_BLOCKED";
  const decision = result.policyResult?.decision;
  const pr = result.policyResult;
  const isScheduled = !!result.scheduleId;
  const rules = pr?.evaluatedRules ?? [];

  let execStatus: string;
  let execClass: string;
  if (isBlocked) { execStatus = "not reached"; execClass = "text-gray-600"; }
  else if (isScheduled) { execStatus = "pending approval"; execClass = "text-yellow-400"; }
  else if (result.txId || result.balanceHbar !== null) { execStatus = "executed"; execClass = "text-green-400"; }
  else { execStatus = "not executed"; execClass = "text-gray-500"; }

  return (
    <section className="swift-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 font-mono select-none">STAGE 3</span>
        <span className="text-sm font-bold text-gray-200">Clearing Agent &amp; Execution</span>
        {badge && !isBlocked && (
          <span className={`ml-auto text-xs px-2 py-0.5 rounded font-mono font-bold ${badge.className}`}>{badge.label}</span>
        )}
        {isBlocked && (
          <span className="ml-auto text-xs px-2 py-0.5 rounded bg-gray-900 text-gray-600 font-mono">SKIPPED</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs font-mono">
        <span className="text-gray-500">Decision</span>
        {isBlocked ? <span className="text-gray-600">not evaluated</span> : (
          <span className={
            decision === "APPROVED" ? "text-green-400"
            : decision === "DENIED" ? "text-red-400"
            : decision === "APPROVAL_REQUIRED" ? "text-yellow-400"
            : decision === "MANUAL_REVIEW" ? "text-orange-400"
            : "text-gray-500"
          }>{decision ?? "—"}</span>
        )}
        {!isBlocked && pr?.denialReason && (<>
          <span className="text-gray-500">Reason</span>
          <span className="text-red-400">{pr.denialReason}</span>
        </>)}
        {!isBlocked && pr?.denialDetail && decision !== "APPROVED" && (<>
          <span className="text-gray-500">Explanation</span>
          <span className="text-gray-400 whitespace-normal">{pr.denialDetail}</span>
        </>)}
        {isBlocked && result.error && (<>
          <span className="text-gray-500">Clarification</span>
          <span className="text-amber-400 whitespace-normal">{result.error}</span>
        </>)}
        <span className="text-gray-500">Execution</span>
        <span className={execClass}>{execStatus}</span>
        {result.txId && (<>
          <span className="text-gray-500">Tx</span>
          <a href={`${HASHSCAN_BASE}/${result.txId}`} target="_blank" rel="noopener noreferrer" className="text-[#5aa6ff] hover:underline break-all">{result.txId}</a>
        </>)}
        {result.scheduleId && (<>
          <span className="text-gray-500">Schedule ID</span>
          <a href={`https://hashscan.io/testnet/schedule/${result.scheduleId}`} target="_blank" rel="noopener noreferrer" className="text-yellow-400 hover:underline break-all">{result.scheduleId}</a>
          {!approvalResult ? (<>
            <span className="text-gray-500">Next step</span>
            <span className="text-yellow-400 whitespace-normal">Awaiting secondary signature via ScheduleSignTransaction</span>
          </>) : (<>
            <span className="text-gray-500">Approval</span><span className="text-green-400">{approvalResult.status}</span>
            <span className="text-gray-500">Sign Tx</span>
            <a href={`${HASHSCAN_BASE}/${approvalResult.signTxId}`} target="_blank" rel="noopener noreferrer" className="text-[#5aa6ff] hover:underline break-all">{approvalResult.signTxId}</a>
            {approvalResult.executionTxId && (<>
              <span className="text-gray-500">Transfer Tx</span>
              <a href={`${HASHSCAN_BASE}/${approvalResult.executionTxId}`} target="_blank" rel="noopener noreferrer" className="text-green-400 hover:underline break-all">{approvalResult.executionTxId}</a>
            </>)}
          </>)}
        </>)}
        {result.balanceHbar !== null && (<>
          <span className="text-gray-500">Balance</span>
          <span className="text-green-400 font-semibold">{result.balanceHbar} HBAR</span>
        </>)}
      </div>

      {result.scheduleId && !approvalResult && (
        <div className="flex items-center gap-3 pt-2 border-t border-white/5">
          <button
            type="button"
            onClick={() => onApproveSchedule(result.scheduleId)}
            disabled={approvalLoading}
            className="swift-btn-warning text-xs"
          >
            {approvalLoading ? "Approving…" : "Approve scheduled transaction"}
          </button>
          <span className="text-xs text-gray-600">Submit secondary signature to release funds</span>
        </div>
      )}
      {approvalError && <p className="text-xs text-red-400 pt-1">{approvalError}</p>}
      {approvalResult && (
        <div className="flex items-center gap-2 pt-2 border-t border-white/5">
          <span className="text-xs px-2 py-0.5 rounded bg-green-950 text-green-400 font-mono font-bold">FUNDS RELEASED</span>
          <span className="text-xs text-gray-500">Schedule approved — transfer executed on Hedera</span>
        </div>
      )}
      {rules.length > 0 && (
        <details className="text-xs text-gray-500">
          <summary className="cursor-pointer hover:text-gray-300 select-none">Rules evaluated ({rules.length})</summary>
          <ul className="mt-1 ml-4 space-y-0.5 list-disc">{rules.map((r) => <li key={r}>{r}</li>)}</ul>
        </details>
      )}
    </section>
  );
}

export default React.memo(StageClearing);
