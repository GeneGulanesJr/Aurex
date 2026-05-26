import { describe, it, expect } from "vitest";
import type {
  MissionStatus, MilestoneStatus, AgentStatus, WorkerStatus, AgentType,
  NegotiatorVerdict, BroadcastLifecycle, BroadcastCategory,
  ResearchLifecycle, ResearchRelevance, CheckpointTrigger, CheckpointDecision,
} from "../src/enums";
import type {
  Mission, MissionConfig, Milestone, WorkingUnit, ValidationContract,
  Handoff, Broadcast, ResearchFinding, AgentSessionRecord, CostEntry,
  RescopeEvent, ValidationVerdict,
} from "../src/types";
import type {
  CreateMissionRequest, CreateMissionResponse, GetMissionResponse,
  CheckpointRequest, CheckpointResponse,
} from "../src/rest";
import type {
  WsClientEvent, EscalationTrigger,
} from "../src/events";

describe("Enums", () => {
  it("MissionStatus includes all states including aborted", () => {
    const statuses: MissionStatus[] = [
      "planning", "running", "paused", "completed", "failed", "aborted",
    ];
    expect(statuses).toHaveLength(6);
  });

  it("AgentStatus includes generic statuses", () => {
    const statuses: AgentStatus[] = [
      "spawned", "planning", "working", "reviewing", "researching",
      "committing", "completed", "timed_out", "failed",
    ];
    expect(statuses).toHaveLength(9);
  });

  it("AgentType has five types including two validators", () => {
    const types: AgentType[] = [
      "orchestrator", "worker", "validator_scrutiny", "validator_user_testing", "research",
    ];
    expect(types).toHaveLength(5);
  });

  it("CheckpointDecision has exactly three values", () => {
    const decisions: CheckpointDecision[] = ["approve", "reject", "rescope"];
    expect(decisions).toHaveLength(3);
  });
});

describe("Core Types", () => {
  it("MissionConfig has all required fields", () => {
    const config: MissionConfig = {
      modelHints: {
        orchestrator: "reasoning-strong",
        worker: "code-fast",
        validator_scrutiny: "reasoning",
        validator_user_testing: "computer-use",
        research: "fast-cheap",
      },
      workerTimeouts: { simple: 120000, build: 300000, testHeavy: 600000 },
      costCap: 50.00,
      maxValidatorRetries: 2,
      maxRescopes: 5,
    };
    expect(config.modelHints).toBeDefined();
    expect(config.workerTimeouts.simple).toBe(120000);
  });

  it("Handoff requires rationale and unresolvedUncertainties", () => {
    const handoff: Handoff = {
      unitId: "unit-1",
      featureName: "Auth",
      description: "Implemented login",
      implemented: "JWT tokens",
      remaining: "Refresh tokens",
      rationale: "Chose JWT for statelessness; refresh tokens deferred to next milestone per contract scope",
      assumptions: "Token expiry is 1 hour",
      unresolvedUncertainties: "none",
      errorsEncountered: "none",
      commandsRun: [{ command: "npm test", exitCode: 0 }],
      gitCommitHash: "abc123",
    };
    expect(handoff.rationale.length).toBeGreaterThan(10);
    expect(handoff.unresolvedUncertainties).toBeDefined();
  });

  it("ValidationVerdict has optional classification", () => {
    const verdict: ValidationVerdict = {
      id: "v-1",
      milestoneId: "ms-1",
      contractId: "c-1",
      validatorType: "validator_scrutiny",
      sessionId: "sess-1",
      verdict: "fail",
      classification: "patchable",
      findings: "Missing error handling in auth middleware",
      failedUnitIds: ["unit-2"],
      timestamp: new Date().toISOString(),
    };
    expect(verdict.classification).toBe("patchable");
  });

  it("ResearchFinding has verifiedTaskId for standing checks", () => {
    const finding: ResearchFinding = {
      id: "f-1",
      missionId: "m-1",
      authorId: "research-1",
      domain: ["auth", "middleware"],
      title: "Token expiry best practices",
      content: "Industry standard is 15min access + 7d refresh",
      relevance: "high",
      status: "unverified",
      verifiedTaskId: null,
      ttl: null,
      expiresAt: null,
      createdAt: new Date().toISOString(),
    };
    expect(finding.verifiedTaskId).toBeNull();
  });

  it("AgentSessionRecord has optional milestoneId and unitId", () => {
    const record: AgentSessionRecord = {
      sessionId: "sess-1",
      agentType: "worker",
      missionId: "m-1",
      milestoneId: "ms-1",
      unitId: "unit-1",
      spawnedAt: new Date().toISOString(),
      terminatedAt: null,
    };
    expect(record.milestoneId).toBe("ms-1");
  });
});
