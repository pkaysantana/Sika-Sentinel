"use client";

import React, { useState, useCallback } from "react";
import type { AuditMessage } from "../../../src/schemas/audit";
import type { Scenario } from "../types";
import { getBadge } from "../types";
import { DEMO_ACTOR_ID } from "../types";

const HASHSCAN_TX  = "https://hashscan.io/testnet/transaction";
const HASHSCAN_SCH = "https://hashscan.io/testnet/schedule";

interface Props {
  scenario: Scenario;
  onRestart: () => void;
}

function FinishStep({ scenario, onRestart }: Props) {
  const actorId = DEMO_ACTOR_ID;

  // ── Audit replay state ──────────────────────────────────────────────────────
  const [auditLog, setAuditLog] = useState<AuditMessage[]>([]);
  const [auditConfigured, setAuditConfigured] = useState<boolean | null>(null);
  const [replayLoading, setReplayLoading] = useState(false);

  const handleReplay = useCallback(async () => {
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
  }, []);

  // ── Whitelist state ─────────────────────────────────────────────────────────
  const [whitelist, setWhitelist] = useState<string[] | null>(null);
  const [whitelistLoading, setWhitelistLoading] = useState(false);
  const [newRecipient, setNewRecipient] = useState("");
  const [whitelistError, setWhitelistError] = useState("");

  const loadWhitelist = useCallback(async () => {
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
  }, [actorId]);

  const handleAddRecipient = useCallback(async (e: React.FormEvent) => {
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
  }, [actorId, newRecipient]);

  return (
    <div className="space-y-8">
      {/* Completion card */}
      <div className="text-center py-8">
        <div className="text-4xl mb-4">{scenario.icon}</div>
        <h2 className="text-2xl font-semibold text-white mb-2">Scenario complete</h2>
        <p className="text-gray-500 text-sm max-w-sm mx-auto">
          You&apos;ve walked through all {scenario.instructions.length} tasks in the{" "}
          <span className="text-gray-300">{scenario.label}</span> scenario.
        </p>
      </div>

      {/* ── Audit replay ─────────────────────────────────────────────────────── */}
      <section className="swift-card p-5 space-y-4" style={{ borderColor: "rgba(180,122,255,0.15)" }}>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold" style={{ color: "#b47aff" }}>Evidence Layer — On-chain Replay</span>
          <button
            type="button"
            onClick={handleReplay}
            disabled={replayLoading}
            className="ml-auto swift-btn-secondary text-xs px-3 py-1.5"
          >
            {replayLoading ? "Loading…" : "Load audit log"}
          </button>
        </div>

        {auditConfigured === null ? (
          <p className="text-xs text-gray-600">Click Load to pull the on-chain audit history from HCS.</p>
        ) : !auditConfigured ? (
          <p className="text-xs text-yellow-600">
            HCS_TOPIC_ID not configured — run{" "}
            <code className="bg-gray-900 px-1 rounded">npm run create-topic</code>{" "}
            then set it in <code className="bg-gray-900 px-1 rounded">.env</code>.
          </p>
        ) : auditLog.length === 0 ? (
          <p className="text-xs text-gray-600">No audit events on this topic yet.</p>
        ) : (
          <div className="space-y-2">
            {auditLog.map((msg: AuditMessage & { hashVerified?: boolean }) => {
              const ac = msg.agentContext;
              const isParseBlocked =
                msg.policyResult.decision === "DENIED" &&
                msg.policyResult.denialReason === null &&
                msg.policyResult.evaluatedRules.length === 0 &&
                !!ac;
              const displayDecision = isParseBlocked ? "PARSE_BLOCKED" : msg.policyResult.decision;
              const b = isParseBlocked
                ? { label: "PARSE BLOCKED", className: "bg-amber-950 text-amber-400" }
                : getBadge(msg.policyResult.decision);
              const decisionClass =
                displayDecision === "APPROVED"          ? "text-green-400"
                : displayDecision === "DENIED"          ? "text-red-400"
                : displayDecision === "APPROVAL_REQUIRED" ? "text-yellow-400"
                : displayDecision === "MANUAL_REVIEW"   ? "text-orange-400"
                : displayDecision === "PARSE_BLOCKED"   ? "text-amber-400"
                : "text-gray-500";

              return (
                <div
                  key={msg.correlationId}
                  className="rounded-xl p-3 text-xs space-y-2"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--hd-border)" }}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-2 py-0.5 rounded font-bold ${b.className}`}>{b.label}</span>
                    <span className="text-gray-600">#{msg.sequenceNumber}</span>
                    <span className="text-gray-600">{new Date(msg.timestamp).toLocaleString()}</span>
                    {ac && (<>
                      <span className="text-gray-700">·</span>
                      <span className="text-[#b47aff]/70">{ac.parserMode}</span>
                      <span className={ac.confidence >= 0.8 ? "text-green-600" : ac.confidence >= 0.5 ? "text-yellow-600" : "text-red-600"}>
                        {Math.round(ac.confidence * 100)}%
                      </span>
                    </>)}
                    {msg.hashVerified !== undefined && (
                      <span className={`text-xs px-1.5 py-0.5 rounded font-mono ml-auto ${msg.hashVerified ? "bg-green-950 text-green-400" : "bg-red-950 text-red-400"}`}>
                        {msg.hashVerified ? "integrity: verified" : "integrity: mismatch"}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-0.5 font-mono">
                    <span className="text-gray-600">Instruction</span>
                    <span className="text-gray-300 break-all">{msg.action.rawInstruction}</span>
                    <span className="text-gray-600">Intent</span>
                    <span className="text-gray-300">{msg.action.actionType}</span>
                    {msg.action.actionType === "HBAR_TRANSFER" && (<>
                      <span className="text-gray-600">Amount</span>
                      <span className="text-gray-300">{msg.action.amountHbar > 0 ? `${msg.action.amountHbar} HBAR` : "—"}</span>
                      <span className="text-gray-600">Recipient</span>
                      <span className="text-gray-300">{msg.action.recipientId || "—"}</span>
                    </>)}
                    <span className="text-gray-600">Decision</span>
                    <span className={decisionClass}>{displayDecision}</span>
                    {!isParseBlocked && msg.policyResult.denialReason && (<>
                      <span className="text-gray-600">Reason</span>
                      <span className="text-red-400">{msg.policyResult.denialReason}</span>
                    </>)}
                    {msg.txId && (<>
                      <span className="text-gray-600">Tx</span>
                      <a href={`${HASHSCAN_TX}/${msg.txId}`} target="_blank" rel="noopener noreferrer" className="text-[#5aa6ff] hover:underline break-all">{msg.txId}</a>
                    </>)}
                    {msg.scheduleId && (<>
                      <span className="text-gray-600">Schedule</span>
                      <a href={`${HASHSCAN_SCH}/${msg.scheduleId}`} target="_blank" rel="noopener noreferrer" className="text-yellow-400 hover:underline break-all">{msg.scheduleId}</a>
                    </>)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Whitelist panel ───────────────────────────────────────────────────── */}
      <section className="swift-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-200">Approved Recipients</span>
          <span className="text-xs text-gray-500 font-mono">· actor: {actorId}</span>
          <button
            type="button"
            onClick={loadWhitelist}
            disabled={whitelistLoading}
            className="ml-auto swift-btn-secondary text-xs px-3 py-1.5"
          >
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
              <li
                key={r}
                className="text-xs font-mono text-gray-300 rounded-lg px-2 py-1"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--hd-border)" }}
              >
                {r}
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={handleAddRecipient} className="flex gap-2">
          <input
            type="text"
            value={newRecipient}
            onChange={(e) => setNewRecipient(e.target.value)}
            placeholder="0.0.xxxxxxx"
            className="flex-1 swift-input text-xs font-mono"
          />
          <button
            type="submit"
            disabled={whitelistLoading || !newRecipient.trim()}
            className="swift-btn-accent text-xs px-3 py-1.5"
          >
            Add
          </button>
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

export default React.memo(FinishStep);
