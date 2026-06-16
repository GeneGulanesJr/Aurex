import { useState, useEffect, useRef } from "react";
import { useNewMissionForm } from "./useNewMissionForm";
import { RepoPicker } from "./RepoPicker";
import { RepoPrepareModal } from "./RepoPrepareModal";
import { RepoOverviewPanel } from "../passive/RepoOverviewPanel";
import type { UseGitHubReturn } from "../hooks/useGitHub";
import { prepareGitHubRepo, exploreRepo, getRepoSummary } from "../api";
import { getSessionState } from "../lib/sessionState";
import type { GitHubRepoResponse, CodeSummaryResponse, CodeHotspotsResponse, RepoSuggestion, RepoReadinessProfile } from "../api";
import type { BumblebeeFinding, BumblebeeScanResult } from "@aurex/shared";
import { animate, stagger } from "animejs";

interface PreparedRepoInfo {
  repoName: string;
  fullName: string;
  summary: CodeSummaryResponse | null;
}

interface MissionCreationViewProps {
  onSubmit: (description: string, cloneUrl?: string) => Promise<void>;
  github?: UseGitHubReturn;
  preparedRepo?: {
    repoName: string;
    fullName: string;
    summary: CodeSummaryResponse | null;
    hotspots: CodeHotspotsResponse | null;
    suggestions: RepoSuggestion[];
    readiness: RepoReadinessProfile | null;
    packageScan: BumblebeeScanResult | null;
    packageFindings: BumblebeeFinding[];
    loading: boolean;
  } | null;
  onRepoPrepared?: (info: PreparedRepoInfo) => void;
  systemReady?: boolean;
  onStartFromSuggestion?: (prefill: string) => void;
}

const examples = [
  '"Add OAuth2 login with Google and GitHub"',
  '"Write tests for the payment module"',
  '"Refactor the API to use Fastify"',
];

export function MissionCreationView({
  onSubmit,
  github,
  preparedRepo,
  onRepoPrepared,
  systemReady,
  onStartFromSuggestion,
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
    const persisted = getSessionState<{ repoName: string; fullName: string }>("prepared_repo");
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
        onRepoPrepared({ repoName: persisted.repoName, fullName: persisted.fullName, summary });
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

    setPreparePhase("cloning");
    let prepared;
    try {
      prepared = await prepareGitHubRepo(pendingRepo.clone_url);
    } catch {
      setPrepareError("Could not clone repository. Check GitHub permissions and try again.");
      setPreparePhase("error");
      return;
    }

    setPreparedRepoName(prepared.repoName);

    setPreparePhase("indexing");
    try {
      const explored = await exploreRepo(prepared.repoName);
      if (explored.status === "completed" && explored.summary) {
        setExploreSummary(explored.summary);
      }
      setPreparePhase("complete");
    } catch {
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
    });
    setPendingRepo(null);
  }

  const handleSuggestionClick = (prefill: string) => {
    if (onStartFromSuggestion) {
      onStartFromSuggestion(prefill);
    } else {
      form.openWithSuggestion(prefill);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
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
            Autonomous Mission Control
          </div>
        </div>

        <MissionLaunchChecklist
          systemReady={!!systemReady}
          githubConnected={!!github?.connected}
          repoCount={github?.repos.length ?? 0}
          selectedRepo={form.state.selectedRepoFullName}
          hasDescription={form.state.description.trim().length > 0}
          hasPreparedRepo={hasPreparedRepo}
          repoLoading={preparedRepo?.loading ?? false}
        />

        {!systemReady ? (
          <div className="creation-section" style={{ width: "100%", padding: "16px", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "6px", textAlign: "center" }}>
            <div style={{ color: "var(--warning)", fontSize: "11px", fontFamily: '"JetBrains Mono", monospace', textTransform: "uppercase", letterSpacing: "1px", marginBottom: "8px" }}>
              Integrations Required
            </div>
            <div style={{ color: "var(--text-muted)", fontSize: "12px" }}>
              Configure GitHub & PiNyx in the Integrations panel before creating missions.
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
                {/* Repo picker */}
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

                {/* Prepared repo card */}
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
                    {preparedRepo.summary ? (
                      <div style={{ color: "var(--text-muted)", fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", marginTop: "4px" }}>
                        {preparedRepo.summary.files} files · {preparedRepo.summary.symbols} symbols · {preparedRepo.summary.modules.length} modules
                      </div>
                    ) : (
                      <div style={{ color: "var(--text-muted)", fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", marginTop: "4px" }}>
                        Status: READY
                      </div>
                    )}
                  </div>
                )}
                {form.state.selectedRepoFullName && !preparedRepo && (
                  <div style={{ color: "var(--accent)", fontSize: "11px", fontFamily: '"JetBrains Mono", monospace' }}>
                    REPO READY · {form.state.selectedRepoFullName}
                  </div>
                )}

                {github?.error && (
                  <p style={{ fontSize: "12px", color: "var(--error)", margin: 0 }}>{github.error}</p>
                )}

                {/* Description textarea */}
                <textarea
                  ref={textareaRef}
                  value={form.state.description}
                  onChange={(e) => form.setDescription(e.target.value)}
                  onKeyDown={form.handleKeyDown}
                  placeholder="Describe what you want done..."
                  style={{
                    width: "100%",
                    background: "var(--bg-inset)",
                    color: "var(--text-primary)",
                    fontSize: "15px",
                    borderRadius: "6px",
                    padding: "14px 16px",
                    border: "1px solid var(--border)",
                    outline: "none",
                    resize: "vertical",
                    fontFamily: '"Inter", sans-serif',
                    lineHeight: 1.6,
                    minHeight: "140px",
                  }}
                  rows={7}
                  autoFocus
                  disabled={form.state.submitting}
                />

                {/* Submit row */}
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <button
                    onClick={form.handleSubmit}
                    disabled={!form.canSubmit}
                    style={{
                      padding: "8px 20px",
                      fontSize: "12px",
                      fontWeight: 600,
                      background: form.canSubmit ? "var(--accent)" : "var(--bg-elevated)",
                      color: form.canSubmit ? "var(--bg-deep)" : "var(--text-muted)",
                      border: "none",
                      borderRadius: "4px",
                      cursor: form.canSubmit ? "pointer" : "default",
                      fontFamily: '"JetBrains Mono", monospace',
                      textTransform: "uppercase",
                      letterSpacing: "1px",
                    }}
                  >
                    {form.state.submitting ? "Creating..." : "Create Mission"}
                  </button>
                  <span style={{ fontSize: "11px", color: "var(--text-muted)", fontFamily: '"JetBrains Mono", monospace' }}>
                    Enter to submit
                  </span>
                </div>

                {form.state.error && <p style={{ fontSize: "12px", color: "var(--error)", margin: 0 }}>{form.state.error}</p>}

                {/* Example missions (only when no repo prepared) */}
                {!hasPreparedRepo && (
                  <div style={{ marginTop: "12px" }}>
                    <div style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "2px", color: "var(--text-muted)", fontFamily: '"JetBrains Mono", monospace', marginBottom: "12px" }}>
                      EXAMPLE MISSIONS
                    </div>
                    {examples.map((text) => (
                      <div
                        key={text}
                        onClick={() => handleExampleClick(text.replace(/^"|"$/g, ""))}
                        style={{
                          background: "var(--bg-surface)",
                          border: "1px solid var(--border)",
                          borderRadius: "6px",
                          padding: "12px 16px",
                          marginBottom: "8px",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "12px",
                          transition: "border-color 0.15s, background 0.15s, box-shadow 0.15s",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = "var(--accent-dim)";
                          e.currentTarget.style.background = "var(--bg-elevated)";
                          e.currentTarget.style.boxShadow = "0 0 12px var(--accent-glow)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = "var(--border)";
                          e.currentTarget.style.background = "var(--bg-surface)";
                          e.currentTarget.style.boxShadow = "none";
                        }}
                      >
                        <span style={{ color: "var(--accent)" }}>◈</span>
                        <span style={{ fontSize: "13px", color: "var(--text-primary)", fontFamily: '"JetBrains Mono", monospace' }}>
                          {text}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Repo overview stays visible so users do not have to hunt through tabs. */}
              {hasPreparedRepo && preparedRepo && (
                <aside className="creation-section mission-overview-card">
                <RepoOverviewPanel
                  repoName={preparedRepo.repoName}
                  fullName={preparedRepo.fullName}
                  summary={preparedRepo.summary}
                  hotspots={preparedRepo.hotspots}
                  suggestions={preparedRepo.suggestions}
                  readiness={preparedRepo.readiness}
                  packageScan={preparedRepo.packageScan}
                  packageFindings={preparedRepo.packageFindings}
                  loading={preparedRepo.loading}
                  onStartMission={handleSuggestionClick}
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


function MissionLaunchChecklist({
  systemReady,
  githubConnected,
  repoCount,
  selectedRepo,
  hasDescription,
  hasPreparedRepo,
  repoLoading,
}: {
  systemReady: boolean;
  githubConnected: boolean;
  repoCount: number;
  selectedRepo?: string;
  hasDescription: boolean;
  hasPreparedRepo: boolean;
  repoLoading: boolean;
}) {
  const items = [
    {
      label: "Connect integrations",
      detail: systemReady ? "GitHub and PiNyx are ready." : "Open Integrations to finish setup.",
      complete: systemReady,
      active: !systemReady,
    },
    {
      label: "Choose a repo",
      detail: selectedRepo ?? (githubConnected ? `${repoCount} repositories available below.` : "Connect GitHub to load repositories."),
      complete: Boolean(selectedRepo),
      active: systemReady && !selectedRepo,
    },
    {
      label: "Review repo context",
      detail: repoLoading ? "Analysis is still running." : hasPreparedRepo ? "Suggestions are visible next to the prompt." : "Pick a repo to unlock suggested missions.",
      complete: hasPreparedRepo && !repoLoading,
      active: Boolean(selectedRepo) && (!hasPreparedRepo || repoLoading),
    },
    {
      label: "Describe the mission",
      detail: hasDescription ? "Prompt is ready to launch." : "Write a goal or click a suggested mission.",
      complete: hasDescription,
      active: systemReady && (hasPreparedRepo || Boolean(selectedRepo)) && !hasDescription,
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
