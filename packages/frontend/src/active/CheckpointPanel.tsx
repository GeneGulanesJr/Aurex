import type { EscalationTrigger } from "@aurex/shared";
import { AttemptHistory } from "./AttemptHistory";

interface CheckpointPanelProps {
  trigger: EscalationTrigger;
}

export function CheckpointPanel({ trigger }: CheckpointPanelProps) {
  switch (trigger.kind) {
    case "milestone_complete":
      return (
        <div style={{ marginBottom: "24px" }}>
          <h2 style={{ fontSize: "20px", fontWeight: 700, color: "var(--success)", marginBottom: "8px" }}>Milestone Complete</h2>
          <p style={{ color: "var(--text-primary)" }}>Release branch: <code style={{ color: "var(--info)" }}>{trigger.releaseBranch ?? "unknown"}</code></p>
          <p style={{ fontSize: "14px", color: "var(--text-secondary)", marginTop: "8px" }}>Review the milestone and approve or reject the release.</p>
        </div>
      );

    case "rescope_limit":
      return (
        <div style={{ marginBottom: "24px" }}>
          <h2 style={{ fontSize: "20px", fontWeight: 700, color: "var(--warning)", marginBottom: "8px" }}>Rescope Limit Reached</h2>
          <AttemptHistory history={trigger.attemptHistory ?? []} />
          <p style={{ fontSize: "14px", color: "var(--text-secondary)", marginTop: "8px" }}>Review the attempts and decide whether to continue work, rescope, or abort.</p>
        </div>
      );

    case "validation_failed":
      return (
        <div style={{ marginBottom: "24px" }}>
          <h2 style={{ fontSize: "20px", fontWeight: 700, color: "var(--warning)", marginBottom: "8px" }}>Validation Needs Direction</h2>
          <p style={{ fontSize: "14px", color: "var(--text-secondary)" }}>The validator still found blocking issues after the configured retry path. Continue work, rescope, or abort.</p>
        </div>
      );

    case "unclassifiable_error":
      return (
        <div style={{ marginBottom: "24px" }}>
          <h2 style={{ fontSize: "20px", fontWeight: 700, color: "var(--error)", marginBottom: "8px" }}>Unclassifiable Error</h2>
          <p style={{ color: "var(--text-primary)", marginBottom: "8px" }}>{trigger.error ?? "Unknown error"}</p>
          <p style={{ fontSize: "14px", color: "var(--text-secondary)" }}>Last attempt: {trigger.lastAttempt ?? "unknown"}</p>
        </div>
      );

    case "cost_cap_exceeded":
      return (
        <div style={{ marginBottom: "24px" }}>
          <h2 style={{ fontSize: "20px", fontWeight: 700, color: "var(--warning)", marginBottom: "8px" }}>Cost Cap Exceeded</h2>
          <p style={{ fontSize: "14px", color: "var(--text-secondary)" }}>Mission spending has reached the cost limit. Approve to continue over budget or abort the mission.</p>
        </div>
      );

    case "quota_exhausted":
      return (
        <div style={{ marginBottom: "24px" }}>
          <h2 style={{ fontSize: "20px", fontWeight: 700, color: "var(--error)", marginBottom: "8px" }}>Quota Exhausted</h2>
          <p style={{ fontSize: "14px", color: "var(--text-secondary)" }}>
            Your coding plan quota has been used up. The window resets at <strong style={{ color: "var(--text-primary)" }}>{trigger.windowResetsAt ? new Date(trigger.windowResetsAt).toLocaleTimeString() : "unknown"}</strong>.
            Approve to resume once the window resets, or abort the mission.
          </p>
        </div>
      );
  }
}
