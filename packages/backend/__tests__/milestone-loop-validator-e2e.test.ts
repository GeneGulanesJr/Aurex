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

  it("worker modifies a real file, validator writes a real pass verdict, and milestone completes", async () => {
    const mission = makeMission();
    const milestone = makeMilestone();
    const unit = makeUnit();
    const verdicts: ValidationVerdict[] = [];
    const handoffs: unknown[] = [];

    const lapis = {
      updateMissionStatus: vi.fn().mockResolvedValue(undefined),
      updateMilestoneStatus: vi.fn().mockResolvedValue(undefined),
      updateWorkingUnitStatus: vi.fn().mockResolvedValue(undefined),
      getWorkingUnitsForMilestone: vi.fn().mockResolvedValue([unit]),
      getContractHistory: vi.fn().mockResolvedValue([
        {
          id: "contract-e2e",
          content: {
            criteria: ["docs/validator-e2e.md contains worker-updated"],
            testCommands: [],
            acceptanceBehavior: "",
          },
        },
      ]),
      writeHandoff: vi.fn().mockImplementation(async (_unitId: string, handoff: unknown) => {
        handoffs.push(handoff);
        return { accepted: true, errors: [] };
      }),
      getHandoffsForMilestone: vi.fn().mockImplementation(async () => (
        handoffs.map((handoff, index) => makeHandoffRecord(handoff, index))
      )),
      writeVerdict: vi.fn().mockImplementation(async (sessionId: string, verdict: Omit<ValidationVerdict, "id" | "sessionId">) => {
        const written = { id: `verdict-${verdicts.length + 1}`, sessionId, ...verdict };
        verdicts.push(written);
        return written;
      }),
      getVerdicts: vi.fn().mockImplementation(async () => verdicts),
      getSessionsForMilestone: vi.fn().mockImplementation(async () => (
        verdicts.map((v: any) => ({
          sessionId: v.sessionId,
          agentType: v.validatorType ?? "validator_scrutiny",
          missionId: "m-e2e",
          milestoneId: "ms-e2e",
          terminatedAt: null,
        }))
      )),
      incrementRetry: vi.fn().mockResolvedValue({ milestoneId: "ms-e2e", retries: 0, rescopes: 0 }),
      registerAgentSession: vi.fn().mockResolvedValue(undefined),
      searchMemory: vi.fn().mockResolvedValue([]),
      runCompression: vi.fn().mockResolvedValue(undefined),

    } as unknown as LaPisClient;

    mockCreateAgentSession.mockImplementation(async (opts: { cwd: string; customTools: Array<{ name: string; execute: Function }> }) => {
      const sessionId = `session-${mockCreateAgentSession.mock.calls.length}`;
      let subscriber: (event: unknown) => void = () => {};
      return {
        session: {
          sessionId,
          subscribe(fn: (event: unknown) => void) {
            subscriber = fn;
            return () => {};
          },
          async prompt() {
            try {
              const handoffTool = opts.customTools.find((tool) => tool.name === "write_handoff");
              const verdictTool = opts.customTools.find((tool) => tool.name === "write_verdict");

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
                  assumptions: "The validator can inspect the worker worktree path from context.",
                  unresolvedUncertainties: "none",
                  errorsEncountered: "none",
                  commandsRun: JSON.stringify([{ command: "git commit", exitCode: 0 }]),
                  gitCommitHash: stdout.trim(),
                });
              }

              if (verdictTool) {
                const workerFile = path.join(repoRoot, ".git-worktrees", "worker-unit-e2e-unit-e2e", "docs", "validator-e2e.md");
                const content = await readFile(workerFile, "utf8");
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
                assistantMessageEvent: {
                  type: "error",
                  message: error instanceof Error ? error.message : String(error),
                },
              });
            }
          },
          abort: vi.fn(),
          dispose: vi.fn(),
        },
      };
    });

    const callbacks = {
      onEscalation: vi.fn(),
      onAgentStatus: vi.fn(),
      onMilestoneProgress: vi.fn(),
      onCostUpdate: vi.fn(),
    };

    const loop = createMilestoneLoop(lapis, {} as PinyxClient, callbacks, {
      agentDir: "/test/.pi/agent",
      repoRoot,
      gitMainBranch: "main",
    });

    const result = await loop.run(mission, [milestone]);

    expect(result.status).toBe("checkpoint_needed");
    if (result.status === "checkpoint_needed") {
      expect(result.trigger).toBe("milestone_complete");
    }
    expect(handoffs).toHaveLength(1);
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]).toMatchObject({
      validatorType: "validator_scrutiny",
      verdict: "pass",
      failedUnitIds: [],
    });
    expect(lapis.updateMilestoneStatus).toHaveBeenCalledWith("ms-e2e", "validating");
    // Milestone is NOT auto-completed — checkpoint needed for human approval
    expect(lapis.updateMilestoneStatus).not.toHaveBeenCalledWith("ms-e2e", "completed");
    expect(callbacks.onEscalation).toHaveBeenCalledWith(
      "mission-e2e",
      { kind: "milestone_complete", milestoneId: "ms-e2e", releaseBranch: "release/mission-e2e/1-ms-e2e" },
      {
        integrationBranch: "integration/mission-e2e/1-ms-e2e",
        releaseBranch: "release/mission-e2e/1-ms-e2e",
        mergedBranches: ["task/worker-unit-e2e/unit-e2e"],
      },
    );

    const { stdout } = await git(repoRoot, "show", "release/mission-e2e/1-ms-e2e:docs/validator-e2e.md");
    expect(stdout).toContain("worker-updated");
  });

  it("returns checkpoint_needed when integration merge fails after validator pass", async () => {
    const mission = makeMission();
    const milestone = makeMilestone();
    const unit = makeUnit();
    const verdicts: ValidationVerdict[] = [];
    const handoffs: unknown[] = [];

    const lapis = {
      updateMissionStatus: vi.fn().mockResolvedValue(undefined),
      updateMilestoneStatus: vi.fn().mockResolvedValue(undefined),
      updateWorkingUnitStatus: vi.fn().mockResolvedValue(undefined),
      getWorkingUnitsForMilestone: vi.fn().mockResolvedValue([unit]),
      getContractHistory: vi.fn().mockResolvedValue([
        {
          id: "contract-e2e",
          content: {
            criteria: ["validation passes before integration"],
            testCommands: [],
            acceptanceBehavior: "",
          },
        },
      ]),
      writeHandoff: vi.fn().mockImplementation(async (_unitId: string, handoff: unknown) => {
        handoffs.push(handoff);
        return { accepted: true, errors: [] };
      }),
      getHandoffsForMilestone: vi.fn().mockImplementation(async () => (
        handoffs.map((handoff, index) => makeHandoffRecord(handoff, index))
      )),
      writeVerdict: vi.fn().mockImplementation(async (sessionId: string, verdict: Omit<ValidationVerdict, "id" | "sessionId">) => {
        const written = { id: `verdict-${verdicts.length + 1}`, sessionId, ...verdict };
        verdicts.push(written);
        return written;
      }),
      getVerdicts: vi.fn().mockImplementation(async () => verdicts),
      getSessionsForMilestone: vi.fn().mockImplementation(async () => (
        verdicts.map((v: any) => ({
          sessionId: v.sessionId,
          agentType: v.validatorType ?? "validator_scrutiny",
          missionId: "m-e2e",
          milestoneId: "ms-e2e",
          terminatedAt: null,
        }))
      )),
      incrementRetry: vi.fn().mockResolvedValue({ milestoneId: "ms-e2e", retries: 0, rescopes: 0 }),
      registerAgentSession: vi.fn().mockResolvedValue(undefined),
      searchMemory: vi.fn().mockResolvedValue([]),
      runCompression: vi.fn().mockResolvedValue(undefined),

    } as unknown as LaPisClient;

    mockCreateAgentSession.mockImplementation(async (opts: { cwd: string; customTools: Array<{ name: string; execute: Function }> }) => {
      const sessionId = `session-${mockCreateAgentSession.mock.calls.length}`;
      let subscriber: (event: unknown) => void = () => {};
      return {
        session: {
          sessionId,
          subscribe(fn: (event: unknown) => void) {
            subscriber = fn;
            return () => {};
          },
          async prompt() {
            try {
              const handoffTool = opts.customTools.find((tool) => tool.name === "write_handoff");
              const verdictTool = opts.customTools.find((tool) => tool.name === "write_verdict");

              if (handoffTool) {
                await writeFile(path.join(repoRoot, "docs", "validator-e2e.md"), "main-conflict\n");
                await git(repoRoot, "add", "docs/validator-e2e.md");
                await git(repoRoot, "commit", "--no-verify", "-m", "docs: conflicting main update");

                await writeFile(path.join(opts.cwd, "docs", "validator-e2e.md"), "worker-conflict\n");
                await git(opts.cwd, "add", "docs/validator-e2e.md");
                await git(opts.cwd, "commit", "-m", "docs: conflicting worker update");
                const { stdout } = await git(opts.cwd, "rev-parse", "HEAD");
                await handoffTool.execute("handoff-call", {
                  featureName: "Conflicting integration fixture",
                  description: "Created a real conflicting docs update",
                  implemented: "Changed docs/validator-e2e.md on worker branch",
                  remaining: "integration conflict must be resolved",
                  rationale: "A real merge conflict proves integration failures become checkpoints.",
                  assumptions: "Git conflict behavior is available in the temporary repository.",
                  unresolvedUncertainties: "none",
                  errorsEncountered: "none",
                  commandsRun: JSON.stringify([{ command: "git commit", exitCode: 0 }]),
                  gitCommitHash: stdout.trim(),
                });
              }

              if (verdictTool) {
                await verdictTool.execute("verdict-call", {
                  verdict: "pass",
                  findings: "Validation passed before integration merge.",
                  failedUnitIds: [],
                });
              }

              subscriber({ type: "agent_end" });
            } catch (error) {
              subscriber({
                type: "message_update",
                assistantMessageEvent: {
                  type: "error",
                  message: error instanceof Error ? error.message : String(error),
                },
              });
            }
          },
          abort: vi.fn(),
          dispose: vi.fn(),
        },
      };
    });

    const callbacks = {
      onEscalation: vi.fn(),
      onAgentStatus: vi.fn(),
      onMilestoneProgress: vi.fn(),
      onCostUpdate: vi.fn(),
    };

    const loop = createMilestoneLoop(lapis, {} as PinyxClient, callbacks, {
      agentDir: "/test/.pi/agent",
      repoRoot,
      gitMainBranch: "main",
    });

    const result = await loop.run(mission, [milestone]);

    expect(result.status).toBe("checkpoint_needed");
    if (result.status === "checkpoint_needed") {
      expect(result.trigger).toBe("unclassifiable_error");
      expect(result.summary).toContain("Integration failed after validation pass");
    }
    expect(handoffs).toHaveLength(1);
    expect(verdicts).toHaveLength(1);
    expect(lapis.updateMilestoneStatus).not.toHaveBeenCalledWith("ms-e2e", "completed");
    expect(callbacks.onEscalation).toHaveBeenCalledWith(
      "mission-e2e",
      { kind: "unclassifiable_error", milestoneId: "ms-e2e" },
      expect.objectContaining({ phase: "integration" }),
    );
  });
});

async function git(cwd: string, ...args: string[]) {
  return execFileAsync("git", args, { cwd });
}

function makeMission(): Mission {
  return {
    id: "mission-e2e",
    description: "Make a tiny docs change and validate it",
    status: "running",
    configJson: {
      modelHints: {
        orchestrator: "reasoning-strong",
        worker: "code-fast",
        validator_scrutiny: "reasoning",
        validator_user_testing: "computer-use",
        research: "fast-cheap",
      },
      workerTimeouts: { simple: 120_000, build: 300_000, testHeavy: 600_000 },
      costCap: 50,
      maxValidatorRetries: 2,
      maxRescopes: 5,
    },
    createdAt: "2026-01-01T00:00:00Z",
  };
}

function makeMilestone(): Milestone {
  return {
    id: "ms-e2e",
    missionId: "mission-e2e",
    title: "Validator E2E",
    description: "Update and validate a docs fixture",
    orderIndex: 0,
    status: "planned",
    validationContractId: "contract-e2e",
  };
}

function makeUnit(): WorkingUnit {
  return {
    id: "unit-e2e",
    milestoneId: "ms-e2e",
    description: "Add worker-updated marker to docs/validator-e2e.md",
    declaredPaths: ["docs/validator-e2e.md"],
    declaredModules: ["docs"],
    status: "pending" as WorkingUnit["status"],
    taskBranch: "",
    worktreePath: "",
    sessionId: "",
  };
}

function makeHandoffRecord(handoff: unknown, index: number) {
  return {
    id: `handoff-${index + 1}`,
    missionId: "mission-e2e",
    milestoneId: "ms-e2e",
    status: "accepted" as const,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...(handoff as Record<string, unknown>),
  };
}
