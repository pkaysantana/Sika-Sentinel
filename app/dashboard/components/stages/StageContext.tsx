"use client";

import React from "react";
import type { PipelineResult } from "../../../../src/runtime/pipeline";
import type { ContextSnapshot } from "../../../../src/context/loader";

interface Props {
  result: PipelineResult;
}

function StageContext({ result }: Props) {
  const ctx = result.context as ContextSnapshot | null;
  const isBlocked = result.stage === "PARSE_BLOCKED";
  const isTransfer = result.action.actionType === "HBAR_TRANSFER";
  const recipientId = result.action.recipientId;

  type AllowlistStatus = "approved" | "not on list" | "not extracted" | "not enforced" | "n/a";
  let allowlistStatus: AllowlistStatus = "n/a";
  let allowlistOk = true;
  if (ctx && isTransfer) {
    if (!ctx.enforceRecipientAllowlist) { allowlistStatus = "not enforced"; }
    else if (!recipientId) { allowlistStatus = "not extracted"; allowlistOk = false; }
    else if (ctx.approvedRecipients.includes(recipientId)) { allowlistStatus = "approved"; }
    else { allowlistStatus = "not on list"; allowlistOk = false; }
  }

  const treasuryClass = !ctx ? "text-gray-600"
    : ctx.treasuryPosture === "NORMAL" ? "text-green-400"
    : ctx.treasuryPosture === "RESTRICTED" ? "text-yellow-400"
    : "text-red-400";

  return (
    <section className="swift-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 font-mono select-none">STAGE 2</span>
        <span className="text-sm font-bold text-[#5aa6ff]">Context Engine</span>
        {isBlocked ? (
          <span className="ml-auto text-xs px-2 py-0.5 rounded bg-gray-900 text-gray-600 font-mono">NOT LOADED</span>
        ) : (
          <span className="ml-auto text-xs px-2 py-0.5 rounded font-mono" style={{ background: "rgba(90,166,255,0.1)", color: "#5aa6ff", border: "1px solid rgba(90,166,255,0.2)" }}>LOADED</span>
        )}
      </div>
      {isBlocked ? (
        <p className="text-xs font-mono text-gray-600">Context not loaded — instruction blocked before pipeline.</p>
      ) : ctx && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs font-mono">
          <span className="text-gray-500">Actor</span><span className="text-gray-200">{ctx.actorId}</span>
          <span className="text-gray-500">Role</span><span className="text-gray-200">{ctx.actorRole}</span>
          <span className="text-gray-500">Partner</span><span className="text-gray-200">{ctx.partnerId}</span>
          <span className="text-gray-500">Treasury</span><span className={treasuryClass}>{ctx.treasuryPosture}</span>
          {isTransfer && (<>
            <span className="text-gray-500">Transfer limit</span><span className="text-gray-200">{ctx.amountThresholdHbar} HBAR</span>
            <span className="text-gray-500">Recipient</span>
            <span className={recipientId ? "text-gray-200" : "text-gray-600"}>{recipientId || "not extracted"}</span>
            <span className="text-gray-500">Allowlist</span>
            <span className={allowlistOk ? "text-green-400" : "text-red-400"}>{allowlistStatus}</span>
          </>)}
        </div>
      )}
    </section>
  );
}

export default React.memo(StageContext);
