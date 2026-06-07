import { useState, useEffect } from "react";
import { useNewMissionForm } from "./useNewMissionForm";
import { RepoPicker } from "./RepoPicker";
import { RepoPrepareModal } from "./RepoPrepareModal";
import type { UseGitHubReturn } from "../hooks/useGitHub";
import { prepareGitHubRepo, exploreRepo } from "../api";
import type { GitHubRepoResponse, CodeSummaryResponse } from "../api";

interface PreparedRepoInfo {
  repoName: string;
  fullName: string;
  summary: CodeSummaryResponse | null;
}

interface NewMissionFormProps {
  onSubmit: (description: string, cloneUrl?: string) => Promise<void>;
  github?: UseGitHubReturn;
  preparedRepo?: PreparedRepoInfo | null;
  onRepoPrepared?: (info: PreparedRepoInfo) => void;
  suggestedDescription?: string;
}

export function NewMissionForm({ onSubmit, github, preparedRepo, onRepoPrepared, suggestedDescription }: NewMissionFormProps) {
  const { state, open, close, setDescription, setRepo, handleSubmit, handleKeyDown, canSubmit } = useNewMissionForm(onSubmit, suggestedDescription);
  const [pendingRepo, setPendingRepo] = useState<GitHubRepoResponse | null>(null);
  const [preparePhase, setPreparePhase] = useState<"confirm" | "cloning" | "indexing" | "complete" | "error">("confirm");
  const [exploreSummary, setExploreSummary] = useState<CodeSummaryResponse | null>(null);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [preparedRepoName, setPreparedRepoName] = useState<string>("");

  const handleRepoSelect = (repo: GitHubRepoResponse) => {
    setPrepareError(null);
    setExploreSummary(null);
    setPreparePhase("confirm");
    setPendingRepo(repo);
  };

  useEffect(() => {
    const handler = () => open();
    window.addEventListener("aurex:focus-new-mission", handler);
    return () => window.removeEventListener("aurex:focus-new-mission", handler);
  }, [open]);

  async function handleConfirmRepo() {
    if (!pendingRepo) return;
    setPrepareError(null);

    // Phase 1: Clone
    setPreparePhase("cloning");
    let prepared;
    try {
      prepared = await prepareGitHubRepo(pendingRepo.clone_url);
    } catch {
      setPrepareError("Could not clone repository. Check GitHub permissions and try again.");
      setPreparePhase("error");
      return;
    }

    // Store repoName from prepare response for later use
    setPreparedRepoName(prepared.repoName);

    // Phase 2: Explore (index)
    setPreparePhase("indexing");
    try {
      const explored = await exploreRepo(prepared.repoName);
      if (explored.status === "completed" && explored.summary) {
        setExploreSummary(explored.summary);
      }
      setPreparePhase("complete");
    } catch {
      // Indexing failed — still usable, just no code map
      setPreparePhase("complete");
    }
  }

  function handleUseRepo() {
    if (!pendingRepo) return;
    setRepo(pendingRepo.clone_url, pendingRepo.id, pendingRepo.full_name);
    // Notify parent to fetch hotspots + suggestions and show overview
    onRepoPrepared?.({
      repoName: preparedRepoName,
      fullName: pendingRepo.full_name,
      summary: exploreSummary,
    });
    setPendingRepo(null);
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
      {/* Compact repo card (Surface C) */}
      {(state.selectedRepoFullName && preparedRepo) ? (
        <div style={{
          background: "var(--bg-inset)",
          border: "1px solid var(--border)",
          borderRadius: "4px",
          padding: "8px 10px",
        }}>
          <div style={{ color: "var(--success)", fontFamily: '"JetBrains Mono", monospace', fontSize: "11px", display: "flex", alignItems: "center", gap: "4px" }}>
            ✓ {state.selectedRepoFullName}
          </div>
          {preparedRepo.summary ? (
            <div style={{ color: "var(--text-muted)", fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", marginTop: "2px" }}>
              {preparedRepo.summary.files} files · {preparedRepo.summary.symbols} symbols · {preparedRepo.summary.modules.length} modules
            </div>
          ) : (
            <div style={{ color: "var(--text-muted)", fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", marginTop: "2px" }}>
              Status: READY
            </div>
          )}
        </div>
      ) : state.selectedRepoFullName ? (
        <div style={{ color: "var(--accent)", fontSize: "10px", fontFamily: '"JetBrains Mono", monospace' }}>
          REPO READY · {state.selectedRepoFullName}
        </div>
      ) : null}
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
          phase={preparePhase}
          summary={exploreSummary}
          error={prepareError}
          onCancel={() => {
            if (preparePhase !== "cloning" && preparePhase !== "indexing") {
              setPendingRepo(null);
              setPrepareError(null);
              setPreparePhase("confirm");
            }
          }}
          onConfirm={() => {
            if (preparePhase === "confirm") {
              void handleConfirmRepo();
            } else if (preparePhase === "complete") {
              handleUseRepo();
            }
          }}
        />
      )}
    </div>
  );
}
