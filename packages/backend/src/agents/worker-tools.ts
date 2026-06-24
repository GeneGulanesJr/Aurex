// packages/backend/src/agents/worker-tools.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { LaPisClient } from "../clients/lapis-client.js";
import type { Handoff, ResearchFinding, StandingContext } from "@aurex/shared";
import { enforceResearchTransition } from "../enforcement/enforcement-gate.js";

const execFileAsync = promisify(execFile);

export interface WorkerToolsOptions {
  onHandoffAccepted?: () => void;
  /**
   * Absolute path to the worker's git worktree. When provided, the
   * write_handoff tool verifies the claimed gitCommitHash is reachable from
   * the branch HEAD before accepting. This prevents workers from submitting
   * fabricated or unrelated commit hashes (observed with some reasoning
   * models that hallucinate a hash instead of running `git commit`).
   */
  worktreePath?: string;
  /**
   * The commit hash the worker's task branch was created from (the branch
   * starting point). When provided alongside worktreePath, write_handoff
   * additionally rejects a claimed hash that is equal to or older than this
   * base — i.e. the worker produced NO new commits. This closes the hole
   * where a worker that forgets `git commit` passes `git rev-parse HEAD`
   * (which yields the base hash); that hash is a valid object and trivially
   * an ancestor of itself, so the reachable-from-HEAD check alone accepts
   * it, leaving an empty diff for validation/integration.
   */
  baseCommitHash?: string;
  /** Mission id — used to look up research findings for verification. */
  missionId?: string;
  /** Returns the current worker session id (the actor for finding transitions). */
  getSessionId?: () => string;
}

/**
 * Verifies the claimed commit hash is reachable from the current branch HEAD
 * in the given worktree. Returns an error message string when the hash is
 * missing, not a real object, or not reachable from HEAD; returns null when
 * the hash is valid (or when verification is disabled/unavailable).
 */
async function verifyCommitReachable(
  worktreePath: string | undefined,
  gitCommitHash: string,
  baseCommitHash?: string,
): Promise<string | null> {
  if (!worktreePath) return null; // verification disabled (e.g. unit tests)
  const hash = (gitCommitHash ?? "").trim();
  if (!hash) return "gitCommitHash is required and must be the hash of a commit you created on this branch.";

  // Guard: only run hard verification inside an actual git worktree. If git
  // is unavailable or the path isn't a repo, skip (return null) rather than
  // blocking — we only reject when we can POSITIVELY determine the hash is
  // wrong. This keeps the check safe in test/non-repo environments.
  try {
    await execFileAsync("git", ["-C", worktreePath, "rev-parse", "--is-inside-work-tree"]);
  } catch {
    return null; // not a git repo or git unavailable — cannot verify, allow
  }

  // Does the commit object exist at all? cat-file -e exits 0 if it does,
  // non-zero otherwise. Any exit code here is a real signal (we're in a repo).
  try {
    await execFileAsync("git", ["-C", worktreePath, "cat-file", "-e", `${hash}^{commit}`]);
  } catch {
    return `gitCommitHash '${hash}' is not a valid commit object in this repository. Run 'git commit' on your task branch and pass the real hash from 'git rev-parse HEAD'.`;
  }

  // Is it reachable from the current branch HEAD (i.e. part of this branch)?
  // merge-base --is-ancestor exits 0 when reachable, 1 when NOT reachable
  // (the signal we want), or 128 on error (treat as "cannot verify, allow").
  try {
    await execFileAsync("git", ["-C", worktreePath, "merge-base", "--is-ancestor", hash, "HEAD"]);
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 1) {
      return `gitCommitHash '${hash}' exists but is NOT reachable from your branch HEAD. The commit must be on your assigned task branch. Run 'git log --oneline -1' to confirm your latest commit, then pass that hash.`;
    }
    // exit 128 or other error — cannot determine, don't block.
    return null;
  }

  // Did the worker actually create a NEW commit, or did it pass the branch
  // base (e.g. by running `git rev-parse HEAD` without ever committing)? A
  // commit is its own ancestor, so the reachable-from-HEAD check above
  // accepts the base hash. When a baseCommitHash is known, reject if the
  // claimed hash is the base or an ancestor of the base (i.e. not newer).
  // `merge-base --is-ancestor <claimed> <base>` exits 0 when claimed is the
  // base or older — that is the "no new commits" signal.
  const base = (baseCommitHash ?? "").trim();
  if (base) {
    try {
      await execFileAsync("git", ["-C", worktreePath, "merge-base", "--is-ancestor", hash, base]);
      // exit 0 => claimed is base or older => NO new commits.
      return `gitCommitHash '${hash}' is the branch starting point (or older) — you produced no new commits on this task branch. Run 'git add' and 'git commit' to record your work (even an empty commit or a documentation update counts), then pass the new 'git rev-parse HEAD' hash. Without a real commit, validation has nothing to merge.`;
    } catch (err) {
      const code = (err as { code?: number }).code;
      // exit 1 => claimed is NOT an ancestor of base => claimed is newer => OK.
      // exit 128 or other => cannot determine; don't block (defense in depth
      // from the reachable-from-HEAD check above still applies).
      if (code !== 1) return null;
    }
  }

  return null;
}

export function createWorkerTools(
  lapis: LaPisClient,
  unitId: string,
  opts?: WorkerToolsOptions,
) {
  const writeHandoff = defineTool({
    name: "write_handoff",
    label: "Write Handoff",
    description:
      "Submit your completed work as a structured handoff. This is required when you finish your working unit. Fill in all fields thoroughly — the handoff is validated and incomplete submissions are rejected. The gitCommitHash MUST be the real hash of a commit you created on your task branch (run 'git rev-parse HEAD' after committing); fabricated or unrelated hashes are rejected.",
    parameters: Type.Object({
      featureName: Type.String({ description: "Name of the feature you implemented" }),
      description: Type.String({ description: "Brief description of what was built" }),
      implemented: Type.String({ description: "What you actually implemented" }),
      remaining: Type.String({ description: "What is left to do (can be 'none')" }),
      rationale: Type.String({ description: "Detailed explanation of your design decisions. Why, not what." }),
      assumptions: Type.String({ description: "Assumptions you made during implementation" }),
      unresolvedUncertainties: Type.String({ description: "Things you are unsure about. 'none' is valid." }),
      errorsEncountered: Type.String({ description: "Any errors encountered during implementation" }),
      commandsRun: Type.String({ description: "JSON array of {command, exitCode} objects for tests you ran" }),
      gitCommitHash: Type.String({ description: "The commit hash of your final commit on this task branch (from 'git rev-parse HEAD'). Must be reachable from your branch." }),
    }),
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      const gitCommitHash = params.gitCommitHash as string;

      // Defense-in-depth: before trusting the claimed hash, verify it is a
      // real commit reachable from this branch HEAD AND (when a base is
      // known) strictly newer than the branch starting point. Reasoning
      // models sometimes hallucinate a hash, borrow one from elsewhere, or
      // simply forget to `git commit` and pass `git rev-parse HEAD` (the
      // base hash). Without these checks the worker session ends with an
      // accepted handoff but an empty branch, and validation/integration
      // have nothing to merge.
      const commitError = await verifyCommitReachable(opts?.worktreePath, gitCommitHash, opts?.baseCommitHash);
      if (commitError) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Handoff rejected — commit verification failed:
${commitError}

You MUST actually run 'git add' and 'git commit' on your task branch, then pass the hash from 'git rev-parse HEAD'. Do not invent a hash or reuse a hash from another branch. If your task is analysis-only and produced no code changes, commit an empty commit or a documentation update so there is a real commit on your branch, then report it accurately in 'implemented'.`,
            },
          ],
          details: {},
        };
      }

      let commandsRun: { command: string; exitCode: number }[];
      try {
        commandsRun = JSON.parse(params.commandsRun as string);
      } catch {
        commandsRun = [];
      }

      const handoff: Handoff = {
        unitId,
        featureName: params.featureName as string,
        description: params.description as string,
        implemented: params.implemented as string,
        remaining: params.remaining as string,
        rationale: params.rationale as string,
        assumptions: params.assumptions as string,
        unresolvedUncertainties: params.unresolvedUncertainties as string,
        errorsEncountered: params.errorsEncountered as string,
        commandsRun,
        gitCommitHash,
      };

      let result;
      try {
        result = await lapis.writeHandoff(unitId, handoff);
      } catch (err) {
        // A LaPis outage (network/DB) would otherwise throw out of the tool
        // executor as an unhandled exception. Surface it as a recoverable
        // rejection the model can act on, matching the sibling tools'
        // (verify_finding/reject_finding) error handling.
        const detail = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `Handoff could not be submitted to shared state: ${detail}\n\nPlease retry write_handoff. If this persists, report the error via errorsEncountered and still submit the handoff so your work is recorded.`,
            },
          ],
          details: {},
        };
      }

      if (result.accepted) {
        opts?.onHandoffAccepted?.();
        return {
          content: [{ type: "text" as const, text: "Handoff accepted. Your work has been recorded." }],
          details: {},
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Handoff rejected:\n${result.errors.join("\n")}\n\nPlease fix these issues and resubmit.`,
          },
        ],
        details: {},
      };
    },
  });

  const searchMemory = defineTool({
    name: "search_memory",
    label: "Search Memory",
    description:
      "Search shared project memory for context about patterns, past decisions, and codebase knowledge. Use this to find relevant context before implementing.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query — be specific for best results" }),
      limit: Type.Optional(Type.Number({ description: "Max results to return (default 10)" })),
    }),
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      const results = await lapis.searchMemory(
        params.query as string,
        params.limit ? { limit: params.limit as number } : undefined,
      );

      if (results.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No results found." }],
          details: {},
        };
      }

      const text = results
        .map((r) => `## ${r.title}\n${r.content}`)
        .join("\n\n---\n\n");

      return {
        content: [{ type: "text" as const, text }],
        details: {},
      };
    },
  });

  const verifyFinding = defineTool({
    name: "verify_finding",
    label: "Verify Finding",
    description:
      "Mark a research finding as verified. Call this when your implementation work confirms the finding is accurate and relevant to your task. The finding moves from 'unverified' to 'verified' and will be trusted by future workers.",
    parameters: Type.Object({
      findingId: Type.String({ description: "The id of the research finding to verify (from the findings in your context)" }),
    }),
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      const result = await transitionFindingForWorker(lapis, unitId, opts, params.findingId as string, "verified");
      return {
        content: [{ type: "text" as const, text: result.message }],
        details: {},
      };
    },
  });

  const rejectFinding = defineTool({
    name: "reject_finding",
    label: "Reject Finding",
    description:
      "Mark a research finding as rejected. Call this when your implementation work shows the finding is inaccurate, outdated, or irrelevant. The finding moves from 'unverified' to 'rejected' so future workers are not misled by it. You MUST supply a reason — it is shown to future workers so they understand why this finding was dismissed and do not re-investigate it.",
    parameters: Type.Object({
      findingId: Type.String({ description: "The id of the research finding to reject (from the findings in your context)" }),
      reason: Type.String({
        description: "Why this finding is being rejected (e.g. 'outdated: auth now uses OAuth2, not JWT', 'inaccurate: the described function no longer exists'). Be specific so future workers don't re-investigate.",
      }),
    }),
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      const reason = ((params.reason as string) ?? "").trim();
      if (!reason) {
        return {
          content: [{ type: "text" as const, text: "Rejecting a finding requires a non-empty 'reason' so future workers understand why it was dismissed." }],
          details: {},
        };
      }
      const result = await transitionFindingForWorker(lapis, unitId, opts, params.findingId as string, "rejected", reason);
      return {
        content: [{ type: "text" as const, text: result.message }],
        details: {},
      };
    },
  });

  return [writeHandoff, searchMemory, verifyFinding, rejectFinding];
}

/**
 * Looks up a research finding by id (via getFindings for the mission), runs
 * the enforcement gate, and performs the lifecycle transition. Returns a
 * user-facing message describing the outcome.
 *
 * The gate prevents invalid transitions (e.g. verifying an already-verified
 * finding) and ensures verification carries a standing context (taskId +
 * workerSessionId) so the audit trail records which worker confirmed it.
 *
 * Concurrency: the finding is re-fetched immediately before the transition and
 * re-validated, and the status we checked against is forwarded to LaPis as an
 * optimistic-concurrency guard. This narrows the stale-read window where two
 * workers could otherwise race on the same finding and overwrite a newer
 * status.
 */
async function transitionFindingForWorker(
  lapis: LaPisClient,
  unitId: string,
  opts: WorkerToolsOptions | undefined,
  findingId: string,
  targetStatus: "verified" | "rejected",
  reason?: string,
): Promise<{ message: string }> {
  const missionId = opts?.missionId;
  const actorId = opts?.getSessionId?.() ?? unitId;

  if (!missionId) {
    return { message: `Cannot transition finding ${findingId}: mission context is not available.` };
  }

  // First load: locate the finding and run the enforcement gate against its
  // current status.
  let findings: ResearchFinding[];
  try {
    findings = await lapis.getFindings(missionId);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { message: `Failed to load findings for mission ${missionId}: ${detail}` };
  }

  const finding = findings.find((f) => f.id === findingId);
  if (!finding) {
    return { message: `Finding ${findingId} was not found among this mission's findings.` };
  }

  const standingContext: StandingContext = { taskId: unitId, workerSessionId: actorId };
  const gate = enforceResearchTransition(finding.status, targetStatus, actorId, standingContext);
  if (!gate.ok) {
    return { message: `Cannot transition finding ${findingId} from '${finding.status}' to '${targetStatus}': ${gate.reason}` };
  }

  // Re-fetch immediately before transitioning and re-validate against the
  // freshest status. Another worker may have transitioned this same finding
  // between the gate check above and now; acting on a stale status could
  // accept an invalid transition or clobber a newer status.
  let currentStatus = finding.status;
  try {
    const refreshed = await lapis.getFindings(missionId);
    const freshFinding = refreshed.find((f) => f.id === findingId);
    if (!freshFinding) {
      return { message: `Cannot transition finding ${findingId}: it was removed before the transition could be applied.` };
    }
    if (freshFinding.status !== currentStatus) {
      return {
        message: `Cannot transition finding ${findingId}: its status changed from '${currentStatus}' to '${freshFinding.status}' while preparing the transition (concurrent modification). Reload findings and re-evaluate.`,
      };
    }
    currentStatus = freshFinding.status;
  } catch (err) {
    // If the freshness re-fetch fails, fall back to forwarding the status we
    // originally checked as the optimistic-concurrency guard so the server can
    // still reject a stale transition if it supports the check.
    const detail = err instanceof Error ? err.message : String(err);
    console.warn(`[worker-tools] Failed to re-verify finding ${findingId} status before transition: ${detail}`);
  }

  try {
    await lapis.transitionFinding(findingId, targetStatus, actorId, standingContext, {
      reason,
      expectedCurrentStatus: currentStatus,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { message: `Finding ${findingId} could not be transitioned to '${targetStatus}': ${detail}` };
  }

  const verb = targetStatus === "verified" ? "verified" : "rejected";
  const reasonSuffix = targetStatus === "rejected" && reason ? ` Reason: ${reason}` : "";
  return { message: `Finding ${findingId} ${verb}.${reasonSuffix}` };
}
