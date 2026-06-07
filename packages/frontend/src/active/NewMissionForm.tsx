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
  const form = useNewMissionForm(onSubmit, suggestedDescription);
  const [pendingRepo, setPendingRepo] = useState<GitHubRepoResponse | null>(null);
  const [preparePhase, setPreparePhase] = useState<"confirm" | "cloning" | "indexing" | "complete" | "error">("confirm");
  const [exploreSummary, setExploreSummary] = useState<CodeSummaryResponse | null>(null);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [preparedRepoName, setPreparedRepoName] = useState<string>("");

  // Track previously-prepared repos so the user doesn't have to re-clone when
  // switching back to a repo that was already scanned.
  const [preparedRepoCache, setPreparedRepoCache] = useState<Map<number, { repoName: string; summary: CodeSummaryResponse | null }>>(new Map());

  const handleRepoSelect = (repo: GitHubRepoResponse) => {
    setPrepareError(null);
    // If we already prepared this repo, skip the modal and use cached data
    const cached = preparedRepoCache.get(repo.id);
    if (cached) {
      setPendingRepo(null);
      form.setRepo(repo.clone_url, repo.id, repo.full_name);
      onRepoPrepared?.({
        repoName: cached.repoName,
        fullName: repo.full_name,
        summary: cached.summary,
      });
      return;
    }
    setExploreSummary(null);
    setPreparePhase("confirm");
    setPendingRepo(repo);
  };

  useEffect(() => {
    const handler = (e: Event) => {
      // The suggestion text is passed in the event detail so it's available
      // synchronously — no need to wait for React state to propagate.
      const detail = (e as CustomEvent).detail as string | undefined;
      if (detail) {
        form.openWithSuggestion(detail);
      } else {
        form.open();
      }
    };
    window.addEventListener("aurex:focus-new-mission", handler);
    return () => window.removeEventListener("aurex:focus-new-mission", handler);
  }, [form.open, form.openWithSuggestion]);

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
    // Cache the prepared repo data so switching back doesn't require re-cloning
    setPreparedRepoCache((prev) => {
      const next = new Map(prev);
      next.set(pendingRepo.id, { repoName: preparedRepoName, summary: exploreSummary });
      return next;
    });
    form.setRepo(pendingRepo.clone_url, pendingRepo.id, pendingRepo.full_name);
    // Notify parent to fetch hotspots + suggestions and show overview
    onRepoPrepared?.({
      repoName: preparedRepoName,
      fullName: pendingRepo.full_name,
      summary: exploreSummary,
    });
    setPendingRepo(null);
  }

  if (!form.state.open) {
    return (
      <button
        onClick={form.open}
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
        <RepoPicker repos={github.repos} selectedRepoId={form.state.selectedRepoId} onSelect={handleRepoSelect} />
      )}
      {/* Compact repo card (Surface C) */}
      {(form.state.selectedRepoFullName && preparedRepo) ? (
        <div style={{
          background: "var(--bg-inset)",
          border: "1px solid var(--border)",
          borderRadius: "4px",
          padding: "8px 10px",
        }}>
          <div style={{ color: "var(--success)", fontFamily: '"JetBrains Mono", monospace', fontSize: "11px", display: "flex", alignItems: "center", gap: "4px" }}>
            ✓ {form.state.selectedRepoFullName}
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
      ) : form.state.selectedRepoFullName ? (
        <div style={{ color: "var(--accent)", fontSize: "10px", fontFamily: '"JetBrains Mono", monospace' }}>
          REPO READY · {form.state.selectedRepoFullName}
        </div>
      ) : null}
      {github?.error && (
        <p style={{ fontSize: "12px", color: "var(--error)", margin: 0 }}>{github.error}</p>
      )}
      <textarea
        value={form.state.description}
        onChange={(e) => form.setDescription(e.target.value)}
        onKeyDown={form.handleKeyDown}
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
        disabled={form.state.submitting}
      />
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <button
          onClick={form.handleSubmit}
          disabled={!form.canSubmit}
          style={{
            padding: "4px 12px",
            fontSize: "12px",
            background: form.canSubmit ? "var(--accent)" : "var(--bg-elevated)",
            color: form.canSubmit ? "var(--bg-deep)" : "var(--text-muted)",
            border: "none",
            borderRadius: "4px",
            cursor: form.canSubmit ? "pointer" : "default",
            fontFamily: '"JetBrains Mono", monospace',
          }}
        >
          {form.state.submitting ? "Creating..." : "Create"}
        </button>
        <button
          onClick={form.close}
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
      {form.state.error && <p style={{ fontSize: "12px", color: "var(--error)", marginTop: "4px" }}>{form.state.error}</p>}
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
