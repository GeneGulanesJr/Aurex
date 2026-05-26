import type { EscalationTrigger } from "@aurex/shared";
import { AttemptHistory } from "./AttemptHistory";

interface CheckpointPanelProps {
  trigger: EscalationTrigger;
}

export function CheckpointPanel({ trigger }: CheckpointPanelProps) {
  switch (trigger.kind) {
    case "milestone_complete":
      return (
        <div className="mb-6">
          <h2 className="text-xl font-bold text-green-400 mb-2">Milestone Complete</h2>
          <p className="text-gray-300">Release branch: <code className="text-blue-400">{trigger.releaseBranch}</code></p>
          <p className="text-sm text-gray-400 mt-2">Review the milestone and approve or reject the release.</p>
        </div>
      );

    case "rescope_limit":
      return (
        <div className="mb-6">
          <h2 className="text-xl font-bold text-orange-400 mb-2">Rescope Limit Reached</h2>
          <AttemptHistory history={trigger.attemptHistory} />
          <p className="text-sm text-gray-400 mt-2">Review the attempts and decide: rescope or abort.</p>
        </div>
      );

    case "unclassifiable_error":
      return (
        <div className="mb-6">
          <h2 className="text-xl font-bold text-red-400 mb-2">Unclassifiable Error</h2>
          <p className="text-gray-300 mb-2">{trigger.error}</p>
          <p className="text-sm text-gray-400">Last attempt: {trigger.lastAttempt}</p>
        </div>
      );
  }
}
