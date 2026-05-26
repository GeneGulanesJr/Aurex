import { useState } from "react";
import type { EscalationTrigger, CheckpointDecision } from "@aurex/shared";

interface DecisionActionsProps {
  onDecision: (decision: CheckpointDecision, guidance?: string, reason?: string) => void;
  trigger: EscalationTrigger;
}

export function DecisionActions({ onDecision, trigger }: DecisionActionsProps) {
  const [guidance, setGuidance] = useState("");
  const [showGuidance, setShowGuidance] = useState(false);

  return (
    <div className="flex gap-3 items-start flex-wrap">
      {trigger.kind === "milestone_complete" && (
        <>
          <button onClick={() => onDecision("approve")} className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded font-medium">Approve</button>
          <button onClick={() => onDecision("reject", undefined, "abandon")} className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded font-medium">Reject</button>
        </>
      )}

      {(trigger.kind === "rescope_limit" || trigger.kind === "unclassifiable_error") && (
        <>
          <button onClick={() => onDecision("rescope", guidance || undefined)} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded font-medium">Review & Rescope</button>
          <button onClick={() => onDecision("reject", undefined, "abort")} className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded font-medium">Abort Mission</button>
          {trigger.kind === "unclassifiable_error" && (
            <button onClick={() => setShowGuidance(!showGuidance)} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded font-medium">Provide Guidance</button>
          )}
        </>
      )}

      {showGuidance && (
        <div className="w-full mt-3">
          <textarea
            value={guidance}
            onChange={(e) => setGuidance(e.target.value)}
            placeholder="Enter guidance for the Orchestrator..."
            className="w-full bg-gray-900 text-gray-200 rounded p-3 border border-gray-700 focus:border-blue-500 outline-none resize-none"
            rows={3}
          />
          <button onClick={() => onDecision("rescope", guidance)} className="mt-2 px-4 py-2 bg-blue-600 rounded font-medium">Submit Guidance</button>
        </div>
      )}
    </div>
  );
}
