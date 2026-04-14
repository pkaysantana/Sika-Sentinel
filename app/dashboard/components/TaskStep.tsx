"use client";

import React, { useState, useCallback } from "react";
import type { PipelineResult } from "../../../src/runtime/pipeline";
import type { ParseResult } from "../../../src/agents/intentParser";
import type { Scenario, ApprovalResult } from "../types";
import { getBadge } from "../types";
import StageParser from "./stages/StageParser";
import StageContext from "./stages/StageContext";
import StageClearing from "./stages/StageClearing";
import StageEvidence from "./stages/StageEvidence";

interface Props {
  scenario: Scenario;
  taskIndex: number;
  totalTasks: number;
  stepNumber: number;
  totalSteps: number;
  actorId: string;
  onNext: () => void;
  onRestart: () => void;
}

function TaskStep({
  scenario,
  taskIndex,
  totalTasks,
  stepNumber,
  totalSteps,
  actorId,
  onNext,
  onRestart,
}: Props) {
  const task = scenario.instructions[taskIndex];
  const isLast = taskIndex === totalTasks - 1;

  const [instruction, setInstruction] = useState(task.text);
  const [result, setResult] = useState<(PipelineResult & { parseResult?: ParseResult }) | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [approvalLoading, setApprovalLoading] = useState(false);
  const [approvalResult, setApprovalResult] = useState<ApprovalResult | null>(null);
  const [approvalError, setApprovalError] = useState("");

  const badge = result?.policyResult ? getBadge(result.policyResult.decision) : null;

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
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
  }, [instruction, actorId]);

  const handleApproveSchedule = useCallback(async (schedId: string) => {
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
  }, []);

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

      {/* Pipeline stages — only shown once a result is available */}
      {result?.parseResult && <StageParser parseResult={result.parseResult} />}
      {result && <StageContext result={result} />}
      {result && (
        <StageClearing
          result={result}
          badge={badge}
          approvalResult={approvalResult}
          approvalLoading={approvalLoading}
          approvalError={approvalError}
          onApproveSchedule={handleApproveSchedule}
        />
      )}
      {result && <StageEvidence result={result} approvalResult={approvalResult} />}

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

export default React.memo(TaskStep);
