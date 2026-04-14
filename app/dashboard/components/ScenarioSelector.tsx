"use client";

import React from "react";
import { SCENARIOS, type ScenarioKey, type Scenario } from "../types";

interface Props {
  selected: ScenarioKey;
  onSelect: (k: ScenarioKey) => void;
  onNext: () => void;
}

function ScenarioSelector({ selected, onSelect, onNext }: Props) {
  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-mono text-gray-500 uppercase tracking-widest mb-1">
          Step 1 of {Object.keys(SCENARIOS).length + 1}
        </p>
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

export default React.memo(ScenarioSelector);
