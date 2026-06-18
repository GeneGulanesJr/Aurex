import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Mission, Milestone, ValidationVerdict, WorkingUnit } from "@aurex/shared";

const execFileAsync = promisify(execFile);

const { mockCreateAgentSession } = vi.hoisted(() => ({
  mockCreateAgentSession: vi.fn(),
}));

vi.mock("@earendil-works/pi-coding-agent", () => {
  class MockResourceLoader {
    reload = vi.fn().mockResolvedValue(undefined);
    getSkills = vi.fn().mockReturnValue([]);
    getExtensions = vi.fn().mockReturnValue([]);
    getAgentsFiles = vi.fn().mockReturnValue({ agentsFiles: [], diagnostics: [] });
  }

  return {
    createAgentSession: mockCreateAgentSession,
    SessionManager: { inMemory: vi.fn() },
    DefaultResourceLoader: MockResourceLoader,
    defineTool: (tool: unknown) => tool,
  };
});

import { createMilestoneLoop } from "../src/orchestrator/milestone-loop";
import type { LaPisClient } from "../src/clients/lapis-client";
import type { PinyxClient } from "../src/clients/pinyx-client";

/**
 * v1 validator E2E (issue #119).
 *
 * These tests run against a REAL throwaway git repository. They verify the
 * sequential single-feature-branch model: every worker commits onto ONE
 * shared `feature/*` branch, the end-of-milestone validator reviews that
 * branch HEAD, and a release branch is cut straight off it on success.
 */
describe("milestone loop validator E2E", () => {
  let repoRoot: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    repoRoot = await mkdtemp(path.join(tmpdir(), "aurex-validator-e2e-"));
    await mkdir(path.join(repoRoot, "docs"), { recursive: true });
    await writeFile(path.join(repoRoot, "docs", "validator-e2e.md"), "before\n");
    await git(repoRoot, "init", "-b", "main");
    await git(repoRoot, "config", "user.email", "aurex@example.test");
    await git(repoRoot, "config", "user.name", "Aurex E2E");
    await git(repoRoot, "add", ".");
    await git(repoRoot, "commit", "-m", "initial");
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it("worker commits to the shared feature branch, validator passes, milestone completes", async () => {
    const mission = makeMission();
    const milestone = makeMilestone();
    const unit = makeUnit();
    const verdicts: ValidationVerdict[] = [];
    const handoffs: unknown[] = [];

    const lapis = makeLapis({ unit, handoffs, verdicts });

    mockCreateAgentSession.mockImplementation(async (opts: { cwd: string; customTools: Array<{ name: string; execute: Function }> }) => {
      const sessionId = `session-${mockCreateAgentSession.mock.calls.length}`;
      let subscriber: (event: unknown) => void = () => {};
      return {
        session: {
          sessionId,
          subscribe(fn: (event: unknown) => void) { subscriber = fn; return () => {}; },
          async prompt() {
            try {
              const handoffTool = opts.customTools.find((t) => t.name === "write_handoff");
              const verdictTool = opts.customTools.find((t) => t.name === "write_verdict");

              if (handoffTool) {
                await writeFile(path.join(opts.cwd, "docs", "validator-e2e.md"), "before\nworker-updated\n");
                await git(opts.cwd, "add", "docs/validator-e2e.md");
                await git(opts.cwd, "commit", "-m", "docs: update validator e2e fixture");
                const { stdout } = await git(opts.cwd, "rev-parse", "HEAD");
                await handoffTool.execute("handoff-call", {
                  featureName: "Validator E2E fixture",
                  description: "Updated the validator E2E docs fixture",
                  implemented: "Added worker-updated marker to docs/validator-e2e.md",
                  remaining: "none",
                  rationale: "A concrete file change proves worker output exists before validation.",
                  assumptions: "The validator inspects the feature worktree from context.",
                  unresolvedUncertainties: "none",
                  errorsEncountered: "none",
                  commandsRun: JSON.stringify([{ command: "git commit", exitCode: 0 }]),
                  gitCommitHash: stdout.trim(),
                });
              }

              if (verdictTool) {
                const content = await readFile(path.join(opts.cwd, "docs", "validator-e2e.md"), "utf8");
                await verdictTool.execute("verdict-call", {
                  verdict: content.includes("worker-updated") ? "pass" : "fail",
                  findings: content.includes("worker-updated")
                    ? "Confirmed docs/validator-e2e.md contains worker-updated."
                    : "docs/validator-e2e.md did not contain worker-updated.",
                  failedUnitIds: content.includes("worker-updated") ? [] : ["unit-e2e"],
                });
              }

              subscriber({ type: "agent_end" });
            } catch (error) {
              subscriber({
                type: "message_update",
                assistantMessageEvent: { type: "error", message: error instanceof Error ? error.message : String(error) },
              });
            }
          },
          abort: vi.fn(),
          dispose: vi.fn(),
        },
      };
    });

    const callbacks = makeCallbacks();
    const loop = createMilestoneLoop(lapis, {} as PinyxClient, callbacks, {
      agentDir: "/test/.pi/agent", repoRoot, gitMainBranch: "main",
    });

    const result = await loop.run(mission, [milestone]);

    expect(result.status).toBe("checkpoint_needed");
    if (result.status === "checkpoint_needed") {
      expect(result.trigger).toBe("milestone_complete");
    }
    expect(handoffs).toHaveLength(1);
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]).toMatchObject({ validatorType: "validator_scrutiny", verdict: "pass", failedUnitIds: [] });
    // Release branch is cut straight off the feature branch and carries the change.
    expect(callbacks.onEscalation).toHaveBeenCalledWith(
      "mission-e2e",
      { kind: "milestone_complete", milestoneId: "ms-e2e", releaseBranch: "release/mission-e2e/1-ms-e2e" },
      { releaseBranch: "release/mission-e2e/1-ms-e2e" },
    );
    const { stdout } = await git(repoRoot, "show", "release/mission-e2e/1-ms-e2e:docs/validator-e2e.md");
    expect(stdout).toContain("worker-updated");
  });

  it("sequential workers stack commits on the shared feature branch", async () => {
    const mission = makeMission();
    const milestone = makeMilestone();
    const units: WorkingUnit[] = [
      makeUnit("unit-a", "Add unit-a marker"),
      makeUnit("unit-b", "Add unit-b marker"),
    ];
    const handoffs: unknown[] = [];
    const verdicts: ValidationVerdict[] = [];
    const lapis = makeLapis({ unit: units[0], handoffs, verdicts, units });

    // createAgentSession does not receive unitId, so distinguish sequential
    // workers by a counter and always APPEND so each commit has new content.
    let workerCount = 0;
    mockCreateAgentSession.mockImplementation(async (opts: { cwd: string; customTools: Array<{ name: string; execute: Function }> }) => {
      const sessionId = `session-${mockCreateAgentSession.mock.calls.length}`;
      let subscriber: (event: unknown) => void = () => {};
      return {
        session: {
          sessionId,
          subscribe(fn: (event: unknown) => void) { subscriber = fn; return () => {}; },
          async prompt() {
            const handoffTool = opts.customTools.find((t) => t.name === "write_handoff");
            const verdictTool = opts.customTools.find((t) => t.name === "write_verdict");
            if (handoffTool) {
              workerCount += 1;
              const stampPath = path.join(opts.cwd, "docs", "unit-stamp.md");
              const existing = await readFile(stampPath, "utf8").catch(() => "");
              await writeFile(stampPath, `${existing}worker-${workerCount}\n`);
              await git(opts.cwd, "add", "docs/unit-stamp.md");
              await git(opts.cwd, "commit", "-m", `docs: worker-${workerCount} stacked commit`);
              const { stdout } = await git(opts.cwd, "rev-parse", "HEAD");
              await handoffTool.execute("handoff-call", {
                featureName: `Worker ${workerCount}`,
                description: `Stacked commit ${workerCount}`,
                implemented: `Appended worker-${workerCount} to docs/unit-stamp.md`,
                remaining: "none",
                rationale: "Each worker appends a commit on the shared feature branch.",
                assumptions: "Sequential workers share one branch.",
                unresolvedUncertainties: "none",
                errorsEncountered: "none",
                commandsRun: JSON.stringify([{ command: "git commit", exitCode: 0 }]),
                gitCommitHash: stdout.trim(),
              });
            }
            if (verdictTool) {
              await verdictTool.execute("verdict-call", { verdict: "pass", findings: "both stacked commits present", failedUnitIds: [] });
            }
            subscriber({ type: "agent_end" });
          },
          abort: vi.fn(),
          dispose: vi.fn(),
        },
      };
    });

    const callbacks = makeCallbacks();
    const loop = createMilestoneLoop(lapis, {} as PinyxClient, callbacks, {
      agentDir: "/test/.pi/agent", repoRoot, gitMainBranch: "main",
    });

    const result = await loop.run(mission, [milestone]);
    expect(result.status).toBe("checkpoint_needed");
    expect(lapis.updateWorkingUnitStatus).toHaveBeenCalledWith("unit-a", "completed");
    expect(lapis.updateWorkingUnitStatus).toHaveBeenCalledWith("unit-b", "completed");
    const { stdout } = await git(repoRoot, "show", "release/mission-e2e/1-ms-e2e:docs/unit-stamp.md");
    expect(stdout).toContain("worker-1");
    expect(stdout).toContain("worker-2");
  });

  it("spawns the validator from the feature worktree, not the base repo root", async () => {
    const mission = makeMission();
    const milestone = makeMilestone();
    const unit = makeUnit();
    const verdicts: ValidationVerdict[] = [];
    const handoffs: unknown[] = [];
    const lapis = makeLapis({ unit, handoffs, verdicts });
    const spawnCwds: string[] = [];

    mockCreateAgentSession.mockImplementation(async (opts: { cwd: string; customTools: Array<{ name: string; execute: Function }> }) => {
      spawnCwds.push(opts.cwd);
      const sessionId = `session-${mockCreateAgentSession.mock.calls.length}`;
      let subscriber: (event: unknown) => void = () => {};
      return {
        session: {
          sessionId,
          subscribe(fn: (event: unknown) => void) { subscriber = fn; return () => {}; },
          async prompt() {
            const handoffTool = opts.customTools.find((t) => t.name === "write_handoff");
            const verdictTool = opts.customTools.find((t) => t.name === "write_verdict");
            if (handoffTool) {
              await writeFile(path.join(opts.cwd, "docs", "validator-e2e.md"), "worker-updated\n");
              await git(opts.cwd, "add", "docs/validator-e2e.md");
              await git(opts.cwd, "commit", "-m", "docs: validator worktree fixture");
              const { stdout } = await git(opts.cwd, "rev-parse", "HEAD");
              await handoffTool.execute("handoff", {
                featureName: "Validator worktree fixture",
                description: "Completed worker work for validator worktree test",
                implemented: "Prepared the feature branch for the validator",
                remaining: "none",
                rationale: "The handoff confirms the worker phase completed before validator spawn.",
                assumptions: "The validator runs from the feature worktree.",
                unresolvedUncertainties: "none",
                errorsEncountered: "none",
                commandsRun: JSON.stringify([{ command: "git commit", exitCode: 0 }]),
                gitCommitHash: stdout.trim(),
              });
            }
            if (verdictTool) {
              await verdictTool.execute("v", { verdict: "pass", findings: "ok", failedUnitIds: [] });
            }
            subscriber({ type: "agent_end" });
          },
          abort: vi.fn(),
          dispose: vi.fn(),
        },
      };
    });

    const callbacks = makeCallbacks();
    const loop = createMilestoneLoop(lapis, {} as PinyxClient, callbacks, {
      agentDir: "/test/.pi/agent", repoRoot, gitMainBranch: "main",
    });

    await loop.run(mission, [milestone]);

    const validatorCwds = spawnCwds.filter((cwd) => cwd.includes(".git-worktrees/feature-"));
    expect(validatorCwds.length).toBeGreaterThan(0);
    expect(validatorCwds[0]).not.toBe(repoRoot);
  });
});

async function git(cwd: string, ...args: string[]) {
  return execFileAsync("git", args, { cwd });
}

function makeLapis(opts: { unit: WorkingUnit; units?: WorkingUnit[]; handoffs: unknown[]; verdicts: ValidationVerdict[] }): LaPisClient {
  const { unit, units, handoffs, verdicts } = opts;
  const list = units ?? [unit];
  return {
    updateMissionStatus: vi.fn().mockResolvedValue(undefined),
    updateMilestoneStatus: vi.fn().mockResolvedValue(undefined),
    updateWorkingUnitStatus: vi.fn().mockResolvedValue(undefined),
    getWorkingUnitsForMilestone: vi.fn().mockResolvedValue(list),
    getContractHistory: vi.fn().mockResolvedValue([{
      id: "contract-e2e",
      content: { criteria: ["docs updated"], testCommands: [], acceptanceBehavior: "" },
    }]),
    writeHandoff: vi.fn().mockImplementation(async (_unitId: string, handoff: unknown) => {
      handoffs.push(handoff);
      return { accepted: true, errors: [] };
    }),
    getHandoffsForMilestone: vi.fn().mockImplementation(async () => (
      handoffs.map((handoff, index) => makeHandoffRecord(handoff, index))
    )),
    getHandoffForUnit: vi.fn().mockImplementation(async (unitId: string) => {
      const idx = list.findIndex((u) => u.id === unitId);
      return idx >= 0 && handoffs[idx] ? makeHandoffRecord(handoffs[idx], idx) : null;
    }),
    writeVerdict: vi.fn().mockImplementation(async (sessionId: string, v: Omit<ValidationVerdict, "id" | "sessionId">) => {
      const written = { id: `verdict-${verdicts.length + 1}`, sessionId, ...v };
      verdicts.push(written);
      return written;
    }),
    getVerdicts: vi.fn().mockImplementation(async () => verdicts),
    getSessionsForMilestone: vi.fn().mockImplementation(async () => (
      verdicts.map((v: any) => ({
        sessionId: v.sessionId, agentType: v.validatorType ?? "validator_scrutiny",
        missionId: "mission-e2e", milestoneId: "ms-e2e", terminatedAt: null,
      }))
    )),
    getRetryCounter: vi.fn().mockResolvedValue({ milestoneId: "ms-e2e", retries: 0, rescopes: 0 }),
    registerAgentSession: vi.fn().mockResolvedValue(undefined),
    searchMemory: vi.fn().mockResolvedValue([]),
    getFindings: vi.fn().mockResolvedValue([]),
    runCompression: vi.fn().mockResolvedValue(undefined),
  } as unknown as LaPisClient;
}

function makeCallbacks() {
  return { onEscalation: vi.fn(), onAgentStatus: vi.fn(), onMilestoneProgress: vi.fn(), onCostUpdate: vi.fn(), onError: vi.fn() };
}

function makeMission(): Mission {
  return {
    id: "mission-e2e", description: "Make a tiny docs change and validate it", status: "running",
    configJson: {
      modelHints: { orchestrator: "reasoning-strong", worker: "code-fast", validator_scrutiny: "reasoning", validator_user_testing: "computer-use", research: "fast-cheap" },
      workerTimeouts: { simple: 120_000, build: 300_000, testHeavy: 600_000 },
      costCap: 50, maxValidatorRetries: 2, maxRescopes: 5,
    },
    createdAt: "2026-01-01T00:00:00Z",
  };
}

function makeMilestone(): Milestone {
  return { id: "ms-e2e", missionId: "mission-e2e", title: "Validator E2E", description: "Update and validate a docs fixture", orderIndex: 0, status: "planned", validationContractId: "contract-e2e" };
}

function makeUnit(id = "unit-e2e", description = "Add worker-updated marker to docs/validator-e2e.md"): WorkingUnit {
  return { id, milestoneId: "ms-e2e", description, declaredPaths: ["docs/validator-e2e.md"], declaredModules: ["docs"], status: "planned", taskBranch: "", worktreePath: "", sessionId: "" };
}

function makeHandoffRecord(handoff: unknown, index: number) {
  return {
    id: `handoff-${index + 1}`, missionId: "mission-e2e", milestoneId: "ms-e2e",
    status: "accepted" as const, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
    ...(handoff as Record<string, unknown>),
  };
}
