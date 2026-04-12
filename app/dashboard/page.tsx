"use client";

import { useState } from "react";
import type { PipelineResult } from "../../src/runtime/pipeline";
import type { ParseResult } from "../../src/agents/intentParser";
import type { AuditMessage } from "../../src/schemas/audit";
import type { ContextSnapshot } from "../../src/context/loader";

const DEMO_ACTOR_ID = "0.0.8570111";

type Instruction = { label: string; text: string; tag: string; tagClass: string };

type ScenarioKey = "remittance" | "ngo" | "sme" | "sikahub";

interface Scenario {
  label: string;
  description: string;
  actorLabel: string;
  partnerLabel: string;
  icon: string;
  instructions: Instruction[];
}

const APPROVED = { tag: "APPROVED",     tagClass: "bg-green-950 text-green-400"  };
const APPROVAL = { tag: "APPROVAL REQ", tagClass: "bg-yellow-950 text-yellow-400" };
const DENIED   = { tag: "DENIED",       tagClass: "bg-red-950 text-red-400"       };
const BALANCE  = { tag: "BALANCE",      tagClass: "bg-[#0c0a1a] text-[#b47aff]"  };
const BLOCKED  = { tag: "BLOCKED",      tagClass: "bg-amber-950 text-amber-400"   };

const SCENARIOS: Record<ScenarioKey, Scenario> = {
  remittance: {
    label: "Remittance operator payout",
    description: "Governed payout from a remittance operator to an approved corridor partner.",
    actorLabel: "Remittance Operator",
    partnerLabel: "Corridor Partner",
    icon: "↗",
    instructions: [
      { label: "Small payout — approved",          text: "Send 5 HBAR to 0.0.8598115",   ...APPROVED },
      { label: "Unapproved wallet — denied",        text: "Send 5 HBAR to 0.0.9999999",   ...DENIED   },
      { label: "High-value — approval required",    text: "Send 200 HBAR to 0.0.8598115", ...APPROVAL },
      { label: "Balance check",                     text: "Check treasury balance",        ...BALANCE  },
      { label: "Vague — clarification needed",      text: "Send money to partner",         ...BLOCKED  },
    ],
  },
  ngo: {
    label: "NGO / aid disbursement",
    description: "Controlled disbursement to an approved field partner with full audit evidence.",
    actorLabel: "NGO Treasury",
    partnerLabel: "Field Partner",
    icon: "🤝",
    instructions: [
      { label: "Small disbursement — approved",     text: "Release 5 HBAR to 0.0.8598115",    ...APPROVED },
      { label: "Unknown wallet — denied",           text: "Release 5 HBAR to 0.0.9999999",    ...DENIED   },
      { label: "Large disbursement — approval req", text: "Release 200 HBAR to 0.0.8598115",  ...APPROVAL },
      { label: "Balance check",                     text: "Check disbursement wallet balance", ...BALANCE  },
      { label: "Vague — clarification needed",      text: "Send funds urgently",               ...BLOCKED  },
    ],
  },
  sme: {
    label: "SME treasury payment",
    description: "Governed treasury payment to an approved vendor or supplier.",
    actorLabel: "SME Treasury",
    partnerLabel: "Vendor / Supplier",
    icon: "🏢",
    instructions: [
      { label: "Vendor payment — approved",         text: "Pay 5 HBAR to 0.0.8598115",   ...APPROVED },
      { label: "Unapproved vendor — denied",        text: "Pay 5 HBAR to 0.0.9999999",   ...DENIED   },
      { label: "Large payment — approval required", text: "Pay 200 HBAR to 0.0.8598115", ...APPROVAL },
      { label: "Balance check",                     text: "Check treasury balance",       ...BALANCE  },
      { label: "Vague — clarification needed",      text: "Pay supplier",                 ...BLOCKED  },
    ],
  },
  sikahub: {
    label: "SikaHub partner corridor",
    description: "Governed payout in a SikaHub-style Ghana / diaspora partner payment flow.",
    actorLabel: "SikaHub Operator",
    partnerLabel: "Corridor Wallet",
    icon: "🌍",
    instructions: [
      { label: "Corridor payout — approved",        text: "Send 5 HBAR to 0.0.8598115",      ...APPROVED },
      { label: "Unapproved corridor — denied",      text: "Send 5 HBAR to 0.0.9999999",      ...DENIED   },
      { label: "High-value — approval required",    text: "Send 200 HBAR to 0.0.8598115",    ...APPROVAL },
      { label: "Balance check",                     text: "Check corridor treasury balance",  ...BALANCE  },
      { label: "Vague — clarification needed",      text: "Send payout now",                 ...BLOCKED  },
    ],
  },
};

type DecisionBadge = { label: string; className: string };

function getBadge(decision?: string): DecisionBadge {
  switch (decision) {
    case "APPROVED":          return { label: "APPROVED",          className: "bg-green-950 text-green-400"  };
    case "DENIED":            return { label: "DENIED",            className: "bg-red-950 text-red-400"      };
    case "APPROVAL_REQUIRED": return { label: "APPROVAL REQUIRED", className: "bg-yellow-950 text-yellow-400"};
    case "MANUAL_REVIEW":     return { label: "MANUAL REVIEW",     className: "bg-orange-950 text-orange-400"};
    default:                  return { label: decision ?? "UNKNOWN", className: "bg-gray-900 text-gray-400"  };
  }
}

// ── Step 0: Scenario selector ─────────────────────────────────────────────────
function ScenarioStep({
  selected,
  onSelect,
  onNext,
}: {
  selected: ScenarioKey;
  onSelect: (k: ScenarioKey) => void;
  onNext: () => void;
}) {
  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-mono text-gray-500 uppercase tracking-widest mb-1">Step 1 of {Object.keys(SCENARIOS).length + 1}</p>
        <h2 className="text-2xl font-semibold text-white">Choose a workflow scenario</h2>
        <p className="text-gray-500 text-sm mt-1">Select the governance context you want to walk through.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {(Object.entries(SCENARIOS) as [ScenarioKey, Scenario][]).map(([key, s]) => {
          const active = selected === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(key)}
              className="text-left rounded-2xl p-5 transition-all duration-150 active:scale-[0.98] cursor-pointer"
              style={{
                background: active ? "rgba(180,122,255,0.1)" : "var(--hd-surface)",
                border: active ? "1px solid rgba(180,122,255,0.45)" : "1px solid var(--hd-border)",
                boxShadow: active ? "0 0 0 1px rgba(180,122,255,0.2), 0 0 20px rgba(180,122,255,0.08)" : undefined,
              }}
            >
              <div className="flex items-start gap-3">
                <span className="text-2xl">{s.icon}</span>
                <div>
                  <p className={`font-semibold text-sm ${active ? "text-[#b47aff]" : "text-gray-200"}`}>{s.label}</p>
                  <p className="text-xs text-gray-500 mt-1">{s.description}</p>
                  <p className="text-xs text-gray-600 mt-2 font-mono">{s.instructions.length} tasks</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex justify-end pt-2">
        <button type="button" onClick={onNext} className="swift-btn-primary px-8">
          Next →
        </button>
      </div>
    </div>
  );
}

// ── Task step ─────────────────────────────────────────────────────────────────
function TaskStep({
  scenario,
  taskIndex,
  totalTasks,
  stepNumber,
  totalSteps,
  actorId,
  onNext,
  onRestart,
}: {
  scenario: Scenario;
  taskIndex: number;
  totalTasks: number;
  stepNumber: number;
  totalSteps: number;
  actorId: string;
  onNext: () => void;
  onRestart: () => void;
}) {
  const task = scenario.instructions[taskIndex];
  const isLast = taskIndex === totalTasks - 1;

  const [instruction, setInstruction] = useState(task.text);
  const [result, setResult] = useState<(PipelineResult & { parseResult?: ParseResult }) | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [approvalLoading, setApprovalLoading] = useState(false);
  const [approvalResult, setApprovalResult] = useState<{
    status: string; signTxId: string; executionTxId: string;
    scheduleId: string; hcsTopicId?: string; hcsSequenceNumber?: number;
  } | null>(null);
  const [approvalError, setApprovalError] = useState("");

  const badge = result?.policyResult ? getBadge(result.policyResult.decision) : null;
  const hashscanBase = "https://hashscan.io/testnet/transaction";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!instruction.trim()) return;
    setLoading(true);
    setError("");
    setResult(null);
    setApprovalResult(null);
    setApprovalError("");
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction, actorId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleApproveSchedule(schedId: string) {
    setApprovalLoading(true);
    setApprovalError("");
    setApprovalResult(null);
    try {
      const res = await fetch("/api/schedule/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleId: schedId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Approval failed");
      setApprovalResult(data);
    } catch (err) {
      setApprovalError(err instanceof Error ? err.message : String(err));
    } finally {
      setApprovalLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-mono text-gray-500 uppercase tracking-widest mb-1">
            Step {stepNumber} of {totalSteps} · Task {taskIndex + 1} of {totalTasks}
          </p>
          <h2 className="text-xl font-semibold text-white">{task.label}</h2>
        </div>
        <span className={`text-xs px-2.5 py-1 rounded-full font-mono font-bold ${task.tagClass}`}>
          {task.tag}
        </span>
      </div>

      {/* Progress dots */}
      <div className="flex gap-1.5">
        {scenario.instructions.map((_, i) => (
          <div
            key={i}
            className="h-1 rounded-full flex-1 transition-all duration-300"
            style={{
              background: i < taskIndex
                ? "var(--hd-purple)"
                : i === taskIndex
                ? "var(--hd-cobalt-l)"
                : "rgba(255,255,255,0.08)",
            }}
          />
        ))}
      </div>

      {/* Context */}
      <div className="swift-card p-4 flex items-center gap-4 text-xs font-mono">
        <div>
          <span className="text-gray-500">Actor · </span>
          <span className="text-gray-300">{scenario.actorLabel}</span>
          <span className="text-gray-600 ml-2">{actorId}</span>
        </div>
        <div className="ml-auto">
          <span className="text-gray-500">Partner · </span>
          <span className="text-gray-300">{scenario.partnerLabel}</span>
        </div>
      </div>

      {/* Instruction form */}
      <form onSubmit={handleSubmit} className="space-y-3">
        <label className="block text-sm font-medium text-gray-400 mb-1">Instruction</label>
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          rows={3}
          className="swift-input resize-none"
        />
        <button
          type="submit"
          disabled={loading || !instruction.trim()}
          className="swift-btn-primary"
        >
          {loading ? "Processing…" : "Run"}
        </button>
      </form>

      {/* Error */}
      {error && (
        <div className="bg-red-950/40 border border-red-900/60 rounded-xl p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* ── Stage 1: Intent Parser ── */}
      {result?.parseResult && (
        <section className={`rounded-2xl p-4 space-y-3 ${
          result.parseResult.clarificationMessage
            ? "bg-amber-950/20 border border-amber-900/50"
            : "swift-card"
        }`}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-500 font-mono select-none">STAGE 1</span>
            <span className="text-sm font-bold hd-gradient-text">Intent Parser Agent</span>
            <span className={`text-xs px-2 py-0.5 rounded font-mono ${
              result.parseResult.parserMode === "heuristic"
                ? "bg-[#0c0a1a] text-[#b47aff] border border-[#b47aff]/20"
                : "bg-purple-950/50 text-purple-300 border border-purple-900/50"
            }`}>{result.parseResult.parserMode}</span>
            <span className={`text-xs px-2 py-0.5 rounded font-mono ${
              result.parseResult.confidence >= 0.8 ? "bg-green-950 text-green-400"
              : result.parseResult.confidence >= 0.5 ? "bg-yellow-950 text-yellow-400"
              : "bg-red-950 text-red-400"
            }`}>{Math.round(result.parseResult.confidence * 100)}% confidence</span>
            {result.parseResult.clarificationMessage ? (
              <span className="ml-auto text-xs px-2 py-0.5 rounded bg-amber-950 text-amber-400 font-mono font-bold">FLOW STOPPED</span>
            ) : (
              <span className="ml-auto text-xs px-2 py-0.5 rounded bg-[#0c0a1a] text-[#b47aff]/70 border border-[#b47aff]/15 font-mono">PASSED</span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs font-mono">
            <span className="text-gray-500">Action type</span>
            <span className="text-gray-200">{result.parseResult.workflowContext.detectedIntent}</span>
            <span className="text-gray-500">Amount</span>
            <span className={result.parseResult.workflowContext.extractedAmount !== null ? "text-gray-200" : "text-gray-600"}>
              {result.parseResult.workflowContext.extractedAmount !== null
                ? `${result.parseResult.workflowContext.extractedAmount} HBAR` : "not found"}
            </span>
            <span className="text-gray-500">Recipient</span>
            <span className={result.parseResult.workflowContext.extractedRecipient !== null ? "text-gray-200" : "text-gray-600"}>
              {result.parseResult.workflowContext.extractedRecipient ?? "not found"}
            </span>
            <span className="text-gray-500">Actor</span>
            <span className="text-gray-200">{result.parseResult.action.actorId}</span>
          </div>

          {result.parseResult.parseErrors.length > 0 && (
            <ul className="space-y-0.5">
              {result.parseResult.parseErrors.map((e, i) => <li key={i} className="text-xs text-yellow-500">⚠ {e}</li>)}
            </ul>
          )}
          {result.parseResult.parseWarnings.length > 0 && (
            <ul className="space-y-0.5">
              {result.parseResult.parseWarnings.map((w, i) => <li key={i} className="text-xs text-orange-400">⚡ {w}</li>)}
            </ul>
          )}
          {result.parseResult.clarificationMessage && (
            <div className="border-t border-amber-900/40 pt-3 space-y-1">
              <p className="text-xs font-semibold text-amber-400">Clarification needed</p>
              <p className="text-sm text-amber-200">{result.parseResult.clarificationMessage}</p>
              <p className="text-xs text-amber-600">Revise and resubmit.</p>
            </div>
          )}
        </section>
      )}

      {/* ── Stage 2: Context Engine ── */}
      {result && (() => {
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
      })()}

      {/* ── Stage 3: Clearing Agent & Execution ── */}
      {result && (() => {
        const isBlocked = result.stage === "PARSE_BLOCKED";
        const decision = result.policyResult?.decision;
        const pr = result.policyResult;
        const isScheduled = !!result.scheduleId;
        let execStatus: string;
        let execClass: string;
        if (isBlocked) { execStatus = "not reached"; execClass = "text-gray-600"; }
        else if (isScheduled) { execStatus = "pending approval"; execClass = "text-yellow-400"; }
        else if (result.txId || result.balanceHbar !== null) { execStatus = "executed"; execClass = "text-green-400"; }
        else { execStatus = "not executed"; execClass = "text-gray-500"; }
        const rules = pr?.evaluatedRules ?? [];

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
                <a href={`${hashscanBase}/${result.txId}`} target="_blank" rel="noopener noreferrer" className="text-[#5aa6ff] hover:underline break-all">{result.txId}</a>
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
                  <a href={`${hashscanBase}/${approvalResult.signTxId}`} target="_blank" rel="noopener noreferrer" className="text-[#5aa6ff] hover:underline break-all">{approvalResult.signTxId}</a>
                  {approvalResult.executionTxId && (<>
                    <span className="text-gray-500">Transfer Tx</span>
                    <a href={`${hashscanBase}/${approvalResult.executionTxId}`} target="_blank" rel="noopener noreferrer" className="text-green-400 hover:underline break-all">{approvalResult.executionTxId}</a>
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
                <button type="button" onClick={() => handleApproveSchedule(result.scheduleId)} disabled={approvalLoading} className="swift-btn-warning text-xs">
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
      })()}

      {/* ── Stage 4: Evidence Layer ── */}
      {result && (() => {
        const isBlocked = result.stage === "PARSE_BLOCKED";
        const decision = result.policyResult?.decision;
        const auditWritten = !!result.hcsTopicId && result.hcsSequenceNumber >= 0;
        const auditFailed = !auditWritten && result.stage !== "PARSE_BLOCKED" && result.stage !== "POLICY_EVALUATED" && result.stage !== "ERROR";
        const displayOutcome = isBlocked ? "PARSE_BLOCKED" : (decision ?? "—");
        const outcomeClass =
          displayOutcome === "APPROVED" ? "text-green-400"
          : displayOutcome === "DENIED" ? "text-red-400"
          : displayOutcome === "APPROVAL_REQUIRED" ? "text-yellow-400"
          : displayOutcome === "MANUAL_REVIEW" ? "text-orange-400"
          : displayOutcome === "PARSE_BLOCKED" ? "text-amber-400"
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
                <a href={`https://hashscan.io/testnet/transaction/${result.txId}`} target="_blank" rel="noopener noreferrer" className="text-[#5aa6ff] hover:underline break-all">{result.txId}</a>
              </>)}
              {result.scheduleId && (<>
                <span className="text-gray-500">Schedule</span>
                <a href={`https://hashscan.io/testnet/schedule/${result.scheduleId}`} target="_blank" rel="noopener noreferrer" className="text-yellow-400 hover:underline break-all">{result.scheduleId}</a>
              </>)}
              {approvalResult && (<>
                <span className="text-gray-500">Approval</span><span className="text-green-400">{approvalResult.status}</span>
                {approvalResult.executionTxId && (<>
                  <span className="text-gray-500">Transfer Tx</span>
                  <a href={`https://hashscan.io/testnet/transaction/${approvalResult.executionTxId}`} target="_blank" rel="noopener noreferrer" className="text-green-400 hover:underline break-all">{approvalResult.executionTxId}</a>
                </>)}
                <span className="text-gray-500">Sign Tx</span>
                <a href={`https://hashscan.io/testnet/transaction/${approvalResult.signTxId}`} target="_blank" rel="noopener noreferrer" className="text-[#5aa6ff] hover:underline break-all">{approvalResult.signTxId}</a>
                {approvalResult.hcsTopicId && (<>
                  <span className="text-gray-500">Approval audit</span>
                  <span className="text-gray-300">#{approvalResult.hcsSequenceNumber}</span>
                </>)}
              </>)}
            </div>
          </section>
        );
      })()}

      {/* Navigation */}
      <div className="flex items-center justify-between pt-2">
        <button type="button" onClick={onRestart} className="swift-btn-secondary text-sm px-4">
          ← Start over
        </button>
        <button type="button" onClick={onNext} className="swift-btn-primary px-8">
          {isLast ? "Finish" : "Next →"}
        </button>
      </div>
    </div>
  );
}

// ── Finish / review step ──────────────────────────────────────────────────────
function FinishStep({
  scenario,
  onRestart,
}: {
  scenario: Scenario;
  onRestart: () => void;
}) {
  const [auditLog, setAuditLog] = useState<AuditMessage[]>([]);
  const [auditConfigured, setAuditConfigured] = useState<boolean | null>(null);
  const [replayLoading, setReplayLoading] = useState(false);
  const [whitelist, setWhitelist] = useState<string[] | null>(null);
  const [whitelistLoading, setWhitelistLoading] = useState(false);
  const [newRecipient, setNewRecipient] = useState("");
  const [whitelistError, setWhitelistError] = useState("");
  const actorId = DEMO_ACTOR_ID;
  const hashscanBase = "https://hashscan.io/testnet/transaction";

  async function handleReplay() {
    setReplayLoading(true);
    try {
      const res = await fetch("/api/audit/replay");
      const data = await res.json();
      setAuditConfigured(data.configured ?? false);
      setAuditLog(data.messages ?? []);
    } catch {
      setAuditConfigured(false);
    } finally {
      setReplayLoading(false);
    }
  }

  async function loadWhitelist() {
    setWhitelistLoading(true);
    setWhitelistError("");
    try {
      const res = await fetch(`/api/whitelist?actorId=${encodeURIComponent(actorId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      setWhitelist(data.recipients ?? []);
    } catch (err) {
      setWhitelistError(err instanceof Error ? err.message : String(err));
    } finally {
      setWhitelistLoading(false);
    }
  }

  async function handleAddRecipient(e: React.FormEvent) {
    e.preventDefault();
    if (!newRecipient.trim()) return;
    setWhitelistLoading(true);
    setWhitelistError("");
    try {
      const res = await fetch("/api/whitelist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorId, recipientId: newRecipient.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add");
      setWhitelist(data.recipients ?? []);
      setNewRecipient("");
    } catch (err) {
      setWhitelistError(err instanceof Error ? err.message : String(err));
    } finally {
      setWhitelistLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* Completion card */}
      <div className="text-center py-8">
        <div className="text-4xl mb-4">{scenario.icon}</div>
        <h2 className="text-2xl font-semibold text-white mb-2">Scenario complete</h2>
        <p className="text-gray-500 text-sm max-w-sm mx-auto">
          You&apos;ve walked through all {scenario.instructions.length} tasks in the <span className="text-gray-300">{scenario.label}</span> scenario.
        </p>
      </div>

      {/* Audit replay */}
      <section className="swift-card p-5 space-y-4" style={{ borderColor: "rgba(180,122,255,0.15)" }}>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold" style={{ color: "#b47aff" }}>Evidence Layer — On-chain Replay</span>
          <button type="button" onClick={handleReplay} disabled={replayLoading} className="ml-auto swift-btn-secondary text-xs px-3 py-1.5">
            {replayLoading ? "Loading…" : "Load audit log"}
          </button>
        </div>
        {auditConfigured === null ? (
          <p className="text-xs text-gray-600">Click Load to pull the on-chain audit history from HCS.</p>
        ) : !auditConfigured ? (
          <p className="text-xs text-yellow-600">
            HCS_TOPIC_ID not configured — run <code className="bg-gray-900 px-1 rounded">npm run create-topic</code> then set it in <code className="bg-gray-900 px-1 rounded">.env</code>.
          </p>
        ) : auditLog.length === 0 ? (
          <p className="text-xs text-gray-600">No audit events on this topic yet.</p>
        ) : (
          <div className="space-y-2">
            {auditLog.map((msg: AuditMessage & { hashVerified?: boolean }) => {
              const ac = msg.agentContext;
              const isParseBlocked = msg.policyResult.decision === "DENIED" && msg.policyResult.denialReason === null && msg.policyResult.evaluatedRules.length === 0 && !!ac;
              const displayDecision = isParseBlocked ? "PARSE_BLOCKED" : msg.policyResult.decision;
              const b = isParseBlocked
                ? { label: "PARSE BLOCKED", className: "bg-amber-950 text-amber-400" }
                : getBadge(msg.policyResult.decision);
              const decisionClass =
                displayDecision === "APPROVED" ? "text-green-400"
                : displayDecision === "DENIED" ? "text-red-400"
                : displayDecision === "APPROVAL_REQUIRED" ? "text-yellow-400"
                : displayDecision === "MANUAL_REVIEW" ? "text-orange-400"
                : displayDecision === "PARSE_BLOCKED" ? "text-amber-400"
                : "text-gray-500";

              return (
                <div key={msg.correlationId} className="rounded-xl p-3 text-xs space-y-2" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--hd-border)" }}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-2 py-0.5 rounded font-bold ${b.className}`}>{b.label}</span>
                    <span className="text-gray-600">#{msg.sequenceNumber}</span>
                    <span className="text-gray-600">{new Date(msg.timestamp).toLocaleString()}</span>
                    {ac && (<>
                      <span className="text-gray-700">·</span>
                      <span className="text-[#b47aff]/70">{ac.parserMode}</span>
                      <span className={ac.confidence >= 0.8 ? "text-green-600" : ac.confidence >= 0.5 ? "text-yellow-600" : "text-red-600"}>{Math.round(ac.confidence * 100)}%</span>
                    </>)}
                    {msg.hashVerified !== undefined && (
                      <span className={`text-xs px-1.5 py-0.5 rounded font-mono ml-auto ${msg.hashVerified ? "bg-green-950 text-green-400" : "bg-red-950 text-red-400"}`}>
                        {msg.hashVerified ? "integrity: verified" : "integrity: mismatch"}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-0.5 font-mono">
                    <span className="text-gray-600">Instruction</span><span className="text-gray-300 break-all">{msg.action.rawInstruction}</span>
                    <span className="text-gray-600">Intent</span><span className="text-gray-300">{msg.action.actionType}</span>
                    {msg.action.actionType === "HBAR_TRANSFER" && (<>
                      <span className="text-gray-600">Amount</span><span className="text-gray-300">{msg.action.amountHbar > 0 ? `${msg.action.amountHbar} HBAR` : "—"}</span>
                      <span className="text-gray-600">Recipient</span><span className="text-gray-300">{msg.action.recipientId || "—"}</span>
                    </>)}
                    <span className="text-gray-600">Decision</span><span className={decisionClass}>{displayDecision}</span>
                    {!isParseBlocked && msg.policyResult.denialReason && (<>
                      <span className="text-gray-600">Reason</span><span className="text-red-400">{msg.policyResult.denialReason}</span>
                    </>)}
                    {msg.txId && (<>
                      <span className="text-gray-600">Tx</span>
                      <a href={`${hashscanBase}/${msg.txId}`} target="_blank" rel="noopener noreferrer" className="text-[#5aa6ff] hover:underline break-all">{msg.txId}</a>
                    </>)}
                    {msg.scheduleId && (<>
                      <span className="text-gray-600">Schedule</span>
                      <a href={`https://hashscan.io/testnet/schedule/${msg.scheduleId}`} target="_blank" rel="noopener noreferrer" className="text-yellow-400 hover:underline break-all">{msg.scheduleId}</a>
                    </>)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Whitelist panel */}
      <section className="swift-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-200">Approved Recipients</span>
          <span className="text-xs text-gray-500 font-mono">· actor: {actorId}</span>
          <button type="button" onClick={loadWhitelist} disabled={whitelistLoading} className="ml-auto swift-btn-secondary text-xs px-3 py-1.5">
            {whitelistLoading ? "Loading…" : whitelist === null ? "Load" : "Refresh"}
          </button>
        </div>
        {whitelistError && <p className="text-xs text-red-400">{whitelistError}</p>}
        {whitelist === null ? (
          <p className="text-xs text-gray-500">Click Load to see the approved recipient list.</p>
        ) : whitelist.length === 0 ? (
          <p className="text-xs text-gray-600">No approved recipients configured.</p>
        ) : (
          <ul className="space-y-1">
            {whitelist.map((r) => (
              <li key={r} className="text-xs font-mono text-gray-300 rounded-lg px-2 py-1" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--hd-border)" }}>{r}</li>
            ))}
          </ul>
        )}
        <form onSubmit={handleAddRecipient} className="flex gap-2">
          <input type="text" value={newRecipient} onChange={(e) => setNewRecipient(e.target.value)} placeholder="0.0.xxxxxxx" className="flex-1 swift-input text-xs font-mono" />
          <button type="submit" disabled={whitelistLoading || !newRecipient.trim()} className="swift-btn-accent text-xs px-3 py-1.5">Add</button>
        </form>
      </section>

      <div className="flex justify-center pt-2">
        <button type="button" onClick={onRestart} className="swift-btn-primary px-10">
          ← Choose another scenario
        </button>
      </div>
    </div>
  );
}

// ── Root component ────────────────────────────────────────────────────────────
export default function Home() {
  const [step, setStep] = useState(0);           // 0 = scenario select, 1..N = tasks, N+1 = finish
  const [scenario, setScenario] = useState<ScenarioKey>("remittance");

  const sc = SCENARIOS[scenario];
  const totalTasks = sc.instructions.length;
  const totalSteps = totalTasks + 2; // scenario select + tasks + finish

  function goNext() { setStep((s) => s + 1); }
  function restart() { setStep(0); }

  return (
    <main className="max-w-3xl mx-auto px-6 py-10 min-h-screen">
      {/* Header */}
      <div className="mb-10 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold hd-gradient-text">Sika Sentinel</h1>
          <p className="text-gray-600 text-xs mt-0.5">Runtime governance · Hedera</p>
        </div>
        {step > 0 && (
          <div className="text-xs font-mono text-gray-600">
            {scenario} · step {step + 1}/{totalSteps}
          </div>
        )}
      </div>

      {step === 0 && (
        <ScenarioStep
          selected={scenario}
          onSelect={setScenario}
          onNext={goNext}
        />
      )}

      {step >= 1 && step <= totalTasks && (
        <TaskStep
          key={`${scenario}-${step}`}
          scenario={sc}
          taskIndex={step - 1}
          totalTasks={totalTasks}
          stepNumber={step + 1}
          totalSteps={totalSteps}
          actorId={DEMO_ACTOR_ID}
          onNext={goNext}
          onRestart={restart}
        />
      )}

      {step > totalTasks && (
        <FinishStep
          scenario={sc}
          onRestart={restart}
        />
      )}
    </main>
  );
}
