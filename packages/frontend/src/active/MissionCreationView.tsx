import { useState, useEffect, useRef } from "react";
import { useNewMissionForm } from "./useNewMissionForm";
import { RepoPicker } from "./RepoPicker";
import { RepoPrepareModal } from "./RepoPrepareModal";
import { RepoScanDashboard } from "../passive/RepoScanDashboard";
import type { UseGitHubReturn } from "../hooks/useGitHub";
import { prepareGitHubRepo, exploreRepo, getRepoSummary } from "../api";
import { getSessionState } from "../lib/sessionState";
import type { GitHubRepoResponse, CodeSummaryResponse } from "../api";
import type { IssueStatus, ReviewReport } from "@aurex/shared";
import { animate, stagger } from "animejs";

interface PreparedRepoInfo {
  repoName: string;
  fullName: string;
  summary: CodeSummaryResponse | null;
  freshIndex?: boolean;
  cloneUrl?: string;
  repoId?: number;
}

interface MissionCreationViewProps {
  onSubmit: (description: string, cloneUrl?: string) => Promise<void>;
  github?: UseGitHubReturn;
  preparedRepo?: {
    repoName: string;
    fullName: string;
    summary: CodeSummaryResponse | null;
    report: ReviewReport | null;
    loading: boolean;
    error?: string | null;
  } | null;
  onRepoPrepared?: (info: PreparedRepoInfo) => void;
  systemReady?: boolean;
  onRescanRepo?: () => void;
  onIssueStatusChange?: (issueId: string, status: IssueStatus) => void;
}

const examples: string[] = [];

export function MissionCreationView({
  onSubmit,
  github,
  preparedRepo,
  onRepoPrepared,
  systemReady,
  onRescanRepo,
  onIssueStatusChange,
}: MissionCreationViewProps) {
  const form = useNewMissionForm(onSubmit);
  const [pendingRepo, setPendingRepo] = useState<GitHubRepoResponse | null>(null);
  const [preparePhase, setPreparePhase] = useState<"confirm" | "cloning" | "indexing" | "complete" | "error">("confirm");
  const [exploreSummary, setExploreSummary] = useState<CodeSummaryResponse | null>(null);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [preparedRepoName, setPreparedRepoName] = useState<string>("");
  const [preparedRepoCache, setPreparedRepoCache] = useState<Map<number, { repoName: string; summary: CodeSummaryResponse | null }>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Aborted flag for the in-flight prepare flow so a force-close during
  // cloning/indexing doesn't leave orphaned state updates landing later.
  const prepareAbortedRef = useRef(false);

  // On mount, ensure the form is marked open so the suggestedDescription
  // effect works. If a draft description was persisted, the lazy reducer
  // initializer already restored it — don't clobber it with open().
  useEffect(() => {
    if (!form.state.open) form.open();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Rehydrate the repo overview after a refresh. If the parent already passed
  // a preparedRepo (e.g. it was never lost), do nothing. Otherwise, if we
  // persisted a repo identity last session, refetch its (already-indexed)
  // summary and notify the parent via onRepoPrepared — which re-triggers the
  // full overview load (hotspots, suggestions, readiness, package scan).
  useEffect(() => {
    if (preparedRepo) return; // parent still has it — nothing to restore
    if (!onRepoPrepared) return;
    const persisted = getSessionState<{ repoName: string; fullName: string; cloneUrl?: string; repoId?: number }>("prepared_repo");
    if (!persisted) return;
    let cancelled = false;
    (async () => {
      let summary: CodeSummaryResponse | null = null;
      try {
        summary = await getRepoSummary(persisted.repoName);
      } catch {
        summary = null; // repo may have been evicted; parent will show a loading-then-empty state
      }
      if (!cancelled) {
        if (persisted.cloneUrl && persisted.repoId != null) {
          form.setRepo(persisted.cloneUrl, persisted.repoId, persisted.fullName);
        }
        onRepoPrepared({ repoName: persisted.repoName, fullName: persisted.fullName, summary, cloneUrl: persisted.cloneUrl, repoId: persisted.repoId });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount only — we want this to run once on first render

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const sections = el.querySelectorAll<HTMLElement>(".creation-section");
    if (sections.length === 0) return;
    animate(sections, {
      opacity: [0, 1],
      translateY: [20, 0],
      delay: stagger(120),
      duration: 500,
      ease: "outExpo",
    });
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as string | undefined;
      if (detail) {
        form.openWithSuggestion(detail);
      } else {
        form.open();
      }
      setTimeout(() => textareaRef.current?.focus(), 50);
    };
    window.addEventListener("aurex:focus-new-mission", handler);
    return () => window.removeEventListener("aurex:focus-new-mission", handler);
  }, [form.open, form.openWithSuggestion]);

  const handleRepoSelect = (repo: GitHubRepoResponse) => {
    setPrepareError(null);
    const cached = preparedRepoCache.get(repo.id);
    if (cached) {
      setPendingRepo(null);
      form.setRepo(repo.clone_url, repo.id, repo.full_name);
    onRepoPrepared?.({
      repoName: cached.repoName,
      fullName: repo.full_name,
      summary: cached.summary,
      cloneUrl: repo.clone_url,
      repoId: repo.id,
    });
      return;
    }
    setExploreSummary(null);
    setPreparePhase("confirm");
    setPendingRepo(repo);
  };

  async function handleConfirmRepo() {
    if (!pendingRepo) return;
    setPrepareError(null);
    prepareAbortedRef.current = false;

    setPreparePhase("cloning");
    let prepared;
    try {
      prepared = await prepareGitHubRepo(pendingRepo.clone_url);
    } catch (err) {
      if (prepareAbortedRef.current) return;
      setPrepareError(err instanceof Error ? err.message : "Could not clone repository. Check GitHub permissions and try again.");
      setPreparePhase("error");
      return;
    }
    // User force-closed the modal while cloning/indexing — drop late updates.
    if (prepareAbortedRef.current) return;

    setPreparedRepoName(prepared.repoName);

    setPreparePhase("indexing");
    try {
      const explored = await exploreRepo(prepared.repoName);
      if (prepareAbortedRef.current) return;
      if (explored.status === "completed" && explored.summary) {
        setExploreSummary(explored.summary);
      }
      setPreparePhase("complete");
    } catch {
      if (prepareAbortedRef.current) return;
      setPreparePhase("complete");
    }
  }

  function handleUseRepo() {
    if (!pendingRepo) return;
    setPreparedRepoCache((prev) => {
      const next = new Map(prev);
      next.set(pendingRepo.id, { repoName: preparedRepoName, summary: exploreSummary });
      return next;
    });
    form.setRepo(pendingRepo.clone_url, pendingRepo.id, pendingRepo.full_name);
    onRepoPrepared?.({
      repoName: preparedRepoName,
      fullName: pendingRepo.full_name,
      summary: exploreSummary,
      freshIndex: true,
      cloneUrl: pendingRepo.clone_url,
      repoId: pendingRepo.id,
    });
    setPendingRepo(null);
  }

  const handleSuggestionClick = (_prefill: string) => {
    // Fix prompts are copied from RepoScanDashboard — no mission flow in v1.
  };

  const handleExampleClick = (text: string) => {
    form.openWithSuggestion(text);
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const hasPreparedRepo = !!preparedRepo;

  return (
    <div ref={containerRef} className="mission-creation-scroll">
      <div className={hasPreparedRepo ? "mission-creation-stage mission-creation-stage--wide" : "mission-creation-stage"}>
        {/* Header */}
        <div className="creation-section mission-creation-hero">
          <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "48px", fontWeight: 700, letterSpacing: "12px", color: "var(--accent)", textShadow: "0 0 40px var(--accent-glow), 0 0 80px var(--accent-glow)", marginBottom: "4px" }}>
            AUREX
          </div>
          <div style={{ fontSize: "13px", letterSpacing: "4px", textTransform: "uppercase", color: "var(--text-muted)", fontFamily: '"JetBrains Mono", monospace' }}>
            Codebase Review
          </div>
        </div>

        <ScanLaunchChecklist
          systemReady={!!github?.connected}
          githubConnected={!!github?.connected}
          repoCount={github?.repos.length ?? 0}
          selectedRepo={form.state.selectedRepoFullName}
          hasPreparedRepo={hasPreparedRepo}
          repoLoading={preparedRepo?.loading ?? false}
          issueCount={preparedRepo?.report?.issues.length ?? 0}
        />

        {!github?.connected ? (
          <div className="creation-section" style={{ width: "100%", padding: "16px", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "6px", textAlign: "center" }}>
            <div style={{ color: "var(--warning)", fontSize: "11px", fontFamily: '"JetBrains Mono", monospace', textTransform: "uppercase", letterSpacing: "1px", marginBottom: "8px" }}>
              GitHub Required
            </div>
            <div style={{ color: "var(--text-muted)", fontSize: "12px" }}>
              Connect GitHub in the Integrations panel to scan repositories.
            </div>
          </div>
        ) : (
          <>
            <div
              className={
                hasPreparedRepo
                  ? "mission-creation-content mission-creation-content--with-overview"
                  : "mission-creation-content"
              }
            >
              {/* Create mission content */}
              <div className="creation-section mission-create-card">
                {github?.connected && github.repos.length > 0 && (
                  <RepoPicker repos={github.repos} selectedRepoId={form.state.selectedRepoId} onSelect={handleRepoSelect} />
                )}
                {github?.connected && github.repos.length === 0 && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: "var(--bg-inset)", border: "1px solid var(--border)", borderRadius: "4px" }}>
                    <span style={{ fontSize: "11px", color: github.loading ? "var(--text-muted)" : "var(--warning)", fontFamily: '"JetBrains Mono", monospace' }}>
                      {github.loading ? "LOADING REPOS..." : "NO REPOS FOUND"}
                    </span>
                    {!github.loading && (
                      <button
                        onClick={() => github.refreshRepos()}
                        style={{ fontSize: "10px", color: "var(--accent)", background: "none", border: "1px solid var(--accent-dim)", borderRadius: "3px", cursor: "pointer", padding: "3px 8px", fontFamily: '"JetBrains Mono", monospace', textTransform: "uppercase", letterSpacing: "1px" }}
                      >
                        Refresh
                      </button>
                    )}
                  </div>
                )}

                {form.state.selectedRepoFullName && preparedRepo && (
                  <div style={{
                    background: "var(--bg-inset)",
                    border: "1px solid var(--border)",
                    borderRadius: "4px",
                    padding: "10px 14px",
                  }}>
                    <div style={{ color: "var(--success)", fontFamily: '"JetBrains Mono", monospace', fontSize: "12px", display: "flex", alignItems: "center", gap: "6px" }}>
                      ✓ {form.state.selectedRepoFullName}
                    </div>
                    {preparedRepo.summary && (
                      <div style={{ color: "var(--text-muted)", fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", marginTop: "4px" }}>
                        {preparedRepo.summary.files} files · {preparedRepo.summary.symbols} symbols
                      </div>
                    )}
                  </div>
                )}

                {github?.error && (
                  <p style={{ fontSize: "12px", color: "var(--error)", margin: 0 }}>{github.error}</p>
                )}
              </div>

              {hasPreparedRepo && preparedRepo && (
                <aside className="creation-section mission-overview-card" style={{ minHeight: "520px" }}>
                  <RepoScanDashboard
                    repoName={preparedRepo.repoName}
                    fullName={preparedRepo.fullName}
                    report={preparedRepo.report}
                    loading={preparedRepo.loading}
                    error={preparedRepo.error}
                    onRescan={onRescanRepo}
                    onIssueStatusChange={onIssueStatusChange}
                  />
                </aside>
              )}
            </div>
          </>
        )}
      </div>

      {/* Repo prepare modal */}
      {pendingRepo && (
        <RepoPrepareModal
          repo={pendingRepo}
          phase={preparePhase}
          summary={exploreSummary}
          error={prepareError}
          onCancel={() => {
            // Always allow closing, even mid-clone/index — the user must not be
            // trapped by a hung server-side prepare. Mark the flow aborted so
            // any late promise resolutions are ignored.
            prepareAbortedRef.current = true;
            setPendingRepo(null);
            setPrepareError(null);
            setPreparePhase("confirm");
          }}
          onConfirm={() => {
            if (preparePhase === "confirm") {
              void handleConfirmRepo();
            } else if (preparePhase === "complete") {
              handleUseRepo();
            }
          }}
          onRetry={() => { void handleConfirmRepo(); }}
        />
      )}
    </div>
  );
}


function ScanLaunchChecklist({
  systemReady,
  githubConnected,
  repoCount,
  selectedRepo,
  hasPreparedRepo,
  repoLoading,
  issueCount,
}: {
  systemReady: boolean;
  githubConnected: boolean;
  repoCount: number;
  selectedRepo?: string;
  hasPreparedRepo: boolean;
  repoLoading: boolean;
  issueCount: number;
}) {
  const items = [
    {
      label: "Connect GitHub",
      detail: systemReady ? "GitHub is ready." : "Open Integrations to finish setup.",
      complete: systemReady,
      active: !systemReady,
    },
    {
      label: "Choose a repo",
      detail: selectedRepo ?? (githubConnected ? `${repoCount} repositories available.` : "Connect GitHub to load repositories."),
      complete: Boolean(selectedRepo),
      active: systemReady && !selectedRepo,
    },
    {
      label: "Scan for issues",
      detail: repoLoading ? "Scan in progress…" : hasPreparedRepo ? `${issueCount} isolated issue(s) with fix prompts.` : "Pick a repo to run LaPis index + scan.",
      complete: hasPreparedRepo && !repoLoading,
      active: Boolean(selectedRepo) && (!hasPreparedRepo || repoLoading),
    },
    {
      label: "Copy fix prompts",
      detail: hasPreparedRepo && issueCount > 0 ? "Select an issue and copy its prompt." : "Fix prompts appear after scan completes.",
      complete: hasPreparedRepo && issueCount > 0 && !repoLoading,
      active: hasPreparedRepo && !repoLoading && issueCount === 0,
    },
  ];

  return (
    <div className="creation-section mission-launch-checklist" aria-label="Mission launch checklist">
      <div className="mission-launch-checklist__header">
        <span>Launch checklist</span>
        <span>{items.filter((item) => item.complete).length}/{items.length} ready</span>
      </div>
      <div className="mission-launch-checklist__items">
        {items.map((item) => (
          <div
            key={item.label}
            className={`mission-launch-checklist__item${item.complete ? " mission-launch-checklist__item--complete" : ""}${item.active ? " mission-launch-checklist__item--active" : ""}`}
          >
            <span className="mission-launch-checklist__dot">{item.complete ? "✓" : item.active ? "→" : "•"}</span>
            <span>
              <strong>{item.label}</strong>
              <small>{item.detail}</small>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
