import { useState, useEffect } from "react";
import { useNewMissionForm } from "./useNewMissionForm";
import { RepoPicker } from "./RepoPicker";
import { RepoPrepareModal } from "./RepoPrepareModal";
import type { UseGitHubReturn } from "../hooks/useGitHub";
import { prepareGitHubRepo } from "../api";
import type { GitHubRepoResponse } from "../api";

interface NewMissionFormProps {
  onSubmit: (description: string, cloneUrl?: string) => Promise<void>;
  github?: UseGitHubReturn;
}

export function NewMissionForm({ onSubmit, github }: NewMissionFormProps) {
  const { state, open, close, setDescription, setRepo, handleSubmit, handleKeyDown, canSubmit } = useNewMissionForm(onSubmit);
  const [pendingRepo, setPendingRepo] = useState<GitHubRepoResponse | null>(null);
  const [preparingRepo, setPreparingRepo] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);

  const handleRepoSelect = (repo: GitHubRepoResponse) => {
    setPrepareError(null);
    setPendingRepo(repo);
  };

  // Listen for keyboard shortcut to focus/open the form
  useEffect(() => {
    const handler = () => open();
    window.addEventListener("aurex:focus-new-mission", handler);
    return () => window.removeEventListener("aurex:focus-new-mission", handler);
  }, [open]);

  async function handleConfirmRepo() {
    if (!pendingRepo) return;
    setPreparingRepo(true);
    setPrepareError(null);
    try {
      const prepared = await prepareGitHubRepo(pendingRepo.clone_url);
      setRepo(pendingRepo.clone_url, pendingRepo.id, prepared.fullName);
      setPendingRepo(null);
    } catch {
      setPrepareError("Could not prepare repository. Check GitHub permissions and try again.");
    } finally {
      setPreparingRepo(false);
    }
  }

  if (!state.open) {
    return (
      <button
        onClick={open}
        style={{
          width: "calc(100% - 32px)",
          padding: "8px 16px",
          margin: "12px 16px",
          background: "var(--accent)",
          color: "var(--bg-deep)",
          border: "none",
          borderRadius: "4px",
          fontSize: "12px",
          fontWeight: 600,
          fontFamily: '"JetBrains Mono", monospace',
          letterSpacing: "1px",
          textTransform: "uppercase" as const,
          cursor: "pointer",
          textAlign: "left" as const,
        }}
      >
        + NEW MISSION
      </button>
    );
  }

  return (
    <div style={{ padding: "8px 16px", borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: "8px" }}>
      {github?.connected && github.repos.length > 0 && (
        <RepoPicker repos={github.repos} selectedRepoId={state.selectedRepoId} onSelect={handleRepoSelect} />
      )}
      {state.selectedRepoFullName && (
        <div style={{ color: "var(--accent)", fontSize: "10px", fontFamily: '"JetBrains Mono", monospace' }}>
          REPO READY · {state.selectedRepoFullName}
        </div>
      )}
      {github?.error && (
        <p style={{ fontSize: "12px", color: "var(--error)", margin: 0 }}>{github.error}</p>
      )}
      <textarea
        value={state.description}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Describe what you want done..."
        style={{
          width: "100%",
          background: "var(--bg-inset)",
          color: "var(--text-primary)",
          fontSize: "14px",
          borderRadius: "4px",
          padding: "8px",
          border: "1px solid var(--border)",
          outline: "none",
          resize: "none",
          fontFamily: '"Inter", sans-serif',
        }}
        rows={3}
        autoFocus
        disabled={state.submitting}
      />
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          style={{
            padding: "4px 12px",
            fontSize: "12px",
            background: canSubmit ? "var(--accent)" : "var(--bg-elevated)",
            color: canSubmit ? "var(--bg-deep)" : "var(--text-muted)",
            border: "none",
            borderRadius: "4px",
            cursor: canSubmit ? "pointer" : "default",
            fontFamily: '"JetBrains Mono", monospace',
          }}
        >
          {state.submitting ? "Creating..." : "Create"}
        </button>
        <button
          onClick={close}
          style={{
            padding: "4px 12px",
            fontSize: "12px",
            color: "var(--text-secondary)",
            background: "none",
            border: "none",
            cursor: "pointer",
            fontFamily: '"JetBrains Mono", monospace',
          }}
        >
          Cancel
        </button>
      </div>
      {state.error && <p style={{ fontSize: "12px", color: "var(--error)", marginTop: "4px" }}>{state.error}</p>}
      {pendingRepo && (
        <RepoPrepareModal
          repo={pendingRepo}
          preparing={preparingRepo}
          error={prepareError}
          onCancel={() => {
            if (!preparingRepo) {
              setPendingRepo(null);
              setPrepareError(null);
            }
          }}
          onConfirm={() => void handleConfirmRepo()}
        />
      )}
    </div>
  );
}
