"use client";

import { useState, useCallback } from "react";
import { SCENARIOS, DEMO_ACTOR_ID, type ScenarioKey } from "./types";
import ScenarioSelector from "./components/ScenarioSelector";
import TaskStep from "./components/TaskStep";
import FinishStep from "./components/FinishStep";

export default function Home() {
  const [step, setStep] = useState(0);           // 0 = scenario select, 1..N = tasks, N+1 = finish
  const [scenario, setScenario] = useState<ScenarioKey>("remittance");

  const sc = SCENARIOS[scenario];
  const totalTasks = sc.instructions.length;
  const totalSteps = totalTasks + 2; // scenario select + tasks + finish

  const goNext   = useCallback(() => setStep((s) => s + 1), []);
  const restart  = useCallback(() => setStep(0), []);

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
        <ScenarioSelector
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
