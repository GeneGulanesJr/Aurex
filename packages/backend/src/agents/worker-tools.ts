// packages/backend/src/agents/worker-tools.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { LaPisClient } from "../clients/lapis-client.js";
import type { Handoff } from "@aurex/shared";

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
    return null; // ancestor check exits 0 => reachable
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 1) {
      return `gitCommitHash '${hash}' exists but is NOT reachable from your branch HEAD. The commit must be on your assigned task branch. Run 'git log --oneline -1' to confirm your latest commit, then pass that hash.`;
    }
    // exit 128 or other error — cannot determine, don't block.
    return null;
  }
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
      // real commit reachable from this branch HEAD. Reasoning models
      // sometimes hallucinate a hash (or borrow one from elsewhere in the
      // repo) instead of actually committing — without this check, the
      // worker session ends with an accepted handoff but an empty branch,
      // and validation/integration have nothing to merge.
      const commitError = await verifyCommitReachable(opts?.worktreePath, gitCommitHash);
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

      const result = await lapis.writeHandoff(unitId, handoff);

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

  return [writeHandoff, searchMemory];
}
