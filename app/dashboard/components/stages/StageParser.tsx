"use client";

import React from "react";
import type { ParseResult } from "../../../../src/agents/intentParser";

interface Props {
  parseResult: ParseResult;
}

function StageParser({ parseResult }: Props) {
  return (
    <section className={`rounded-2xl p-4 space-y-3 ${
      parseResult.clarificationMessage
        ? "bg-amber-950/20 border border-amber-900/50"
        : "swift-card"
    }`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-gray-500 font-mono select-none">STAGE 1</span>
        <span className="text-sm font-bold hd-gradient-text">Intent Parser Agent</span>
        <span className={`text-xs px-2 py-0.5 rounded font-mono ${
          parseResult.parserMode === "heuristic"
            ? "bg-[#0c0a1a] text-[#b47aff] border border-[#b47aff]/20"
            : "bg-purple-950/50 text-purple-300 border border-purple-900/50"
        }`}>{parseResult.parserMode}</span>
        <span className={`text-xs px-2 py-0.5 rounded font-mono ${
          parseResult.confidence >= 0.8 ? "bg-green-950 text-green-400"
          : parseResult.confidence >= 0.5 ? "bg-yellow-950 text-yellow-400"
          : "bg-red-950 text-red-400"
        }`}>{Math.round(parseResult.confidence * 100)}% confidence</span>
        {parseResult.clarificationMessage ? (
          <span className="ml-auto text-xs px-2 py-0.5 rounded bg-amber-950 text-amber-400 font-mono font-bold">FLOW STOPPED</span>
        ) : (
          <span className="ml-auto text-xs px-2 py-0.5 rounded bg-[#0c0a1a] text-[#b47aff]/70 border border-[#b47aff]/15 font-mono">PASSED</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs font-mono">
        <span className="text-gray-500">Action type</span>
        <span className="text-gray-200">{parseResult.workflowContext.detectedIntent}</span>
        <span className="text-gray-500">Amount</span>
        <span className={parseResult.workflowContext.extractedAmount !== null ? "text-gray-200" : "text-gray-600"}>
          {parseResult.workflowContext.extractedAmount !== null
            ? `${parseResult.workflowContext.extractedAmount} HBAR` : "not found"}
        </span>
        <span className="text-gray-500">Recipient</span>
        <span className={parseResult.workflowContext.extractedRecipient !== null ? "text-gray-200" : "text-gray-600"}>
          {parseResult.workflowContext.extractedRecipient ?? "not found"}
        </span>
        <span className="text-gray-500">Actor</span>
        <span className="text-gray-200">{parseResult.action.actorId}</span>
      </div>

      {parseResult.parseErrors.length > 0 && (
        <ul className="space-y-0.5">
          {parseResult.parseErrors.map((e, i) => <li key={i} className="text-xs text-yellow-500">⚠ {e}</li>)}
        </ul>
      )}
      {parseResult.parseWarnings.length > 0 && (
        <ul className="space-y-0.5">
          {parseResult.parseWarnings.map((w, i) => <li key={i} className="text-xs text-orange-400">⚡ {w}</li>)}
        </ul>
      )}
      {parseResult.clarificationMessage && (
        <div className="border-t border-amber-900/40 pt-3 space-y-1">
          <p className="text-xs font-semibold text-amber-400">Clarification needed</p>
          <p className="text-sm text-amber-200">{parseResult.clarificationMessage}</p>
          <p className="text-xs text-amber-600">Revise and resubmit.</p>
        </div>
      )}
    </section>
  );
}

export default React.memo(StageParser);
