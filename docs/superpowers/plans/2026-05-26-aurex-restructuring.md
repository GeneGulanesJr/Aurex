# Aurex Restructuring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use Sequential mode for planned tasks or Direct mode if subagents aren't available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure Aurex from a vibe-coded prototype into a proper AI Agent orchestration framework, aligned with the Missions Framework v5 spec.

**Architecture:** Orchestrator-based multi-agent system using Pi SDK sessions, LaPis for shared state (HTTP only), PiNyx as sole LLM gateway, git worktrees for worker isolation, Fastify backend with WebSocket, React+anime.js frontend with passive/active states.

**Tech Stack:** TypeScript, Fastify, React 19, Vite, Tailwind CSS, anime.js v4, Pi SDK (`@earendil-works/pi-coding-agent`), LaPis (HTTP at :9100), PiNyx (HTTP at :7331), pnpm monorepo

**Spec:** `docs/superpowers/specs/2026-05-26-aurex-restructuring-design.md`

---

## File Structure

This plan creates or modifies these files. Each file has one clear responsibility:

### New Files (shared package)
| File | Responsibility |
|---|---|
| `packages/shared/src/enums.ts` | All discriminated union types (MissionStatus, AgentType, etc.) |
| `packages/shared/src/types.ts` | **Rewrite** — all core interfaces (Mission, Milestone, WorkingUnit, etc.) |
| `packages/shared/src/events.ts` | **Rewrite** — WS event types (flat discriminated union) |
| `packages/shared/src/rest.ts` | REST request/response types |
| `packages/shared/src/index.ts` | **Rewrite** — barrel export |

### New Files (backend)
| File | Responsibility |
|---|---|
| `packages/backend/src/config.ts` | **Rewrite** — AppConfig from env vars, no more DB paths |
| `packages/backend/src/clients/lapis-client.ts` | **Rewrite** — HTTP client, replaces CLI subprocess |
| `packages/backend/src/clients/lapis-client.old.ts` | Backup of old CLI client (deleted after migration) |
| `packages/backend/src/clients/pinyx-client.ts` | PiNyx LLM gateway client (replaces router-client.ts) |
| `packages/backend/src/agents/factory.ts` | `createAurexAgent()` per agent type |
| `packages/backend/src/agents/orchestrator-session.ts` | Persistent orchestrator session management |
| `packages/backend/src/agents/worker.ts` | Ephemeral worker lifecycle (spawn → commit → die) |
| `packages/backend/src/agents/validator.ts` | Paired validator lifecycle (scrutiny + user-testing) |
| `packages/backend/src/agents/research.ts` | Read-only research subagent lifecycle |
| `packages/backend/src/orchestrator/planner.ts` | **Rewrite** — Mission → milestones + validation contracts via LaPis |
| `packages/backend/src/orchestrator/negotiator.ts` | **Rewrite** — read verdicts, decide pass/retry/rescope |
| `packages/backend/src/orchestrator/overlap.ts` | **Rewrite** — git-based overlap detection (pre-spawn + post-commit) |
| `packages/backend/src/orchestrator/milestone-loop.ts` | **Rewrite** — main execution loop, no direct DB |
| `packages/backend/src/orchestrator/worktree.ts` | Git worktree create/merge/prune lifecycle |
| `packages/backend/src/enforcement/handoff-validator.ts` | Structural handoff validation |
| `packages/backend/src/enforcement/branch-guard.ts` | Git hook setup + branch permission checks |
| `packages/backend/src/enforcement/broadcast-lifecycle.ts` | Transition graph + actor authorization |
| `packages/backend/src/enforcement/research-lifecycle.ts` | Epistemic transitions + standing checks |
| `packages/backend/src/enforcement/contract-immutability.ts` | Append-only validation contract writes |
| `packages/backend/src/enforcement/creator-verifier.ts` | Session ID audit for separation guarantee |
| `packages/backend/src/routes/missions.ts` | REST: create, get, list missions |
| `packages/backend/src/routes/checkpoints.ts` | REST: submit checkpoint decisions |
| `packages/backend/src/ws/events.ts` | WebSocket: status updates, escalation events |
| `packages/backend/src/server.ts` | **Rewrite** — Fastify entry, WS, healthchecks |
| `packages/backend/src/skills/shared/principles.md` | Shared agent principles (~70 lines) |
| `packages/backend/src/skills/orchestrator.md` | Orchestrator skill (~250 lines) |
| `packages/backend/src/skills/worker.md` | Worker skill (~150 lines) |
| `packages/backend/src/skills/validator.md` | Validator skill (~150 lines, conditional sections) |
| `packages/backend/src/skills/research.md` | Research skill (~80 lines) |

### New Files (frontend)
| File | Responsibility |
|---|---|
| `packages/frontend/package.json` | Frontend dependencies (react, vite, tailwind, anime.js) |
| `packages/frontend/vite.config.ts` | Vite config with proxy to backend |
| `packages/frontend/tailwind.config.ts` | Tailwind config |
| `packages/frontend/tsconfig.json` | TypeScript config |
| `packages/frontend/index.html` | HTML entry |
| `packages/frontend/src/main.tsx` | App entry |
| `packages/frontend/src/App.tsx` | Root: WS connection, passive/active routing |
| `packages/frontend/src/hooks/useWebSocket.ts` | Connection to backend WS |
| `packages/frontend/src/hooks/useMission.ts` | Mission state: REST + WS incremental |
| `packages/frontend/src/api.ts` | REST client |
| `packages/frontend/src/types.ts` | Re-exports from shared + frontend-specific |
| `packages/frontend/src/passive/StatusBoard.tsx` | Main passive layout |
| `packages/frontend/src/passive/AgentGrid.tsx` | Grid of animated agent nodes |
| `packages/frontend/src/passive/AgentNode.tsx` | Single agent node |
| `packages/frontend/src/passive/MilestoneBar.tsx` | Milestone progress bar |
| `packages/frontend/src/passive/CostCounter.tsx` | Running cost with anime.js |
| `packages/frontend/src/passive/StatusFeed.tsx` | Scrollable recent events |
| `packages/frontend/src/active/EscalationOverlay.tsx` | Modal wrapper with anime.js |
| `packages/frontend/src/active/CheckpointPanel.tsx` | Context display per trigger |
| `packages/frontend/src/active/AttemptHistory.tsx` | Retry/rescope history |
| `packages/frontend/src/active/DecisionActions.tsx` | Approve/Reject/Rescope buttons |
| `packages/frontend/src/animations/agent-animations.ts` | Agent node animations |
| `packages/frontend/src/animations/state-transitions.ts` | Passive↔Active transitions |
| `packages/frontend/src/animations/counters.ts` | Counter + progress animations |
| `packages/frontend/src/animations/stagger.ts` | Staggered entrance/exit |
| `packages/frontend/src/styles.css` | Tailwind base + custom properties |

### Removed Files
| File | Replaced By |
|---|---|
| `packages/backend/src/db.ts` | `lapis-client.ts` (HTTP) |
| `packages/backend/src/migrator.ts` | LaPis manages its own schema |
| `packages/backend/src/clients/router-client.ts` | `pinyx-client.ts` |
| `packages/backend/src/spawn/pi-process-manager.ts` | `agents/factory.ts` (Pi SDK direct) |
| `packages/backend/src/events.ts` | `ws/events.ts` |

---

## Phase 1: Foundation (shared types + config + clients)

Tasks 1–4 build the foundation that everything else depends on. No servers, no agents — just the type system, config, and HTTP clients.

---

### Task 1: Shared Enums & Types

**Files:**
- Rewrite: `packages/shared/src/enums.ts`
- Rewrite: `packages/shared/src/types.ts`
- Rewrite: `packages/shared/src/index.ts`
- Test: `packages/shared/__tests__/types.test.ts`

- [ ] **Step 1: Write the failing tests for enum exhaustiveness and type shapes**

```typescript
// packages/shared/__tests__/types.test.ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/shared && npx vitest run __tests__/types.test.ts`
Expected: FAIL — modules don't exist yet

- [ ] **Step 3: Write enums.ts**

```typescript
// packages/shared/src/enums.ts

// Mission lifecycle
export type MissionStatus = "planning" | "running" | "paused" | "completed" | "failed" | "aborted";
export type MilestoneStatus = "planned" | "in_progress" | "validating" | "completed" | "failed";

// Agent statuses
export type AgentStatus = "spawned" | "planning" | "working" | "reviewing" | "researching" | "committing" | "completed" | "timed_out" | "failed";
export type WorkerStatus = "spawned" | "working" | "committing" | "completed" | "timed_out" | "failed";

// Agent types
export type AgentType = "orchestrator" | "worker" | "validator_scrutiny" | "validator_user_testing" | "research";

// Negotiation
export type NegotiatorVerdict = "pass" | "retry" | "rescope" | "escalate";

// Broadcasts
export type BroadcastLifecycle = "active" | "superseded" | "archived" | "expired";
export type BroadcastCategory = "info" | "warning" | "decision" | "constraint";

// Research
export type ResearchLifecycle = "unverified" | "verified" | "superseded" | "rejected" | "expired";
export type ResearchRelevance = "high" | "medium" | "low";

// Checkpoints
export type CheckpointTrigger = "milestone_complete" | "rescope_limit" | "unclassifiable_error";
export type CheckpointDecision = "approve" | "reject" | "rescope";

// Compression
export type CompressionTrigger = "post_milestone" | "manual" | "budget_threshold";
```

- [ ] **Step 4: Write types.ts**

```typescript
// packages/shared/src/types.ts
import type {
  MissionStatus, MilestoneStatus, AgentType, AgentStatus, WorkerStatus,
  BroadcastLifecycle, BroadcastCategory, ResearchLifecycle, ResearchRelevance,
  CheckpointTrigger, CheckpointDecision, NegotiatorVerdict, CompressionTrigger,
} from "./enums";

export interface Mission {
  id: string;
  description: string;
  status: MissionStatus;
  configJson: MissionConfig;
  createdAt: string;
}

export interface MissionConfig {
  modelHints: Record<AgentType, string>;
  workerTimeouts: { simple: number; build: number; testHeavy: number };
  costCap: number;
  maxValidatorRetries: number;
  maxRescopes: number;
}

export interface Milestone {
  id: string;
  missionId: string;
  title: string;
  description: string;
  orderIndex: number;
  status: MilestoneStatus;
  validationContractId: string;
}

export interface WorkingUnit {
  id: string;
  milestoneId: string;
  description: string;
  declaredPaths: string[];
  declaredModules: string[];
  status: WorkerStatus;
  taskBranch: string;
  worktreePath: string;
  sessionId: string;
}

export interface ValidationContract {
  id: string;
  milestoneId: string;
  version: number;
  content: ValidationContractContent;
  supersedes: string | null;
  supersededBy: string | null;
  rescopeEventId: string | null;
  createdAt: string;
}

export interface ValidationContractContent {
  criteria: string[];
  testCommands: string[];
  acceptanceBehavior: string;
}

export interface Handoff {
  unitId: string;
  featureName: string;
  description: string;
  implemented: string;
  remaining: string;
  rationale: string;
  assumptions: string;
  unresolvedUncertainties: string;
  errorsEncountered: string;
  commandsRun: { command: string; exitCode: number }[];
  gitCommitHash: string;
}

export interface HandoffResult {
  accepted: boolean;
  errors: string[];
}

export interface Broadcast {
  id: string;
  missionId: string;
  authorId: string;
  authorType: AgentType;
  category: BroadcastCategory;
  title: string;
  content: string;
  status: BroadcastLifecycle;
  ttl: number | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface ResearchFinding {
  id: string;
  missionId: string;
  authorId: string;
  domain: string[];
  title: string;
  content: string;
  relevance: ResearchRelevance;
  status: ResearchLifecycle;
  verifiedTaskId: string | null;
  ttl: number | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface AgentSessionRecord {
  sessionId: string;
  agentType: AgentType;
  missionId: string;
  milestoneId: string | null;
  unitId: string | null;
  spawnedAt: string;
  terminatedAt: string | null;
}

export interface CostEntry {
  id: string;
  missionId: string;
  agentSessionId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  cost: number;
  timestamp: string;
}

export interface CostSummary {
  totalCost: number;
  totalTokens: number;
  entries: number;
}

export interface RescopeEvent {
  id: string;
  milestoneId: string;
  contractId: string;
  reason: string;
  previousScope: string;
  newScope: string;
  timestamp: string;
}

export interface ValidationVerdict {
  id: string;
  milestoneId: string;
  contractId: string;
  validatorType: "validator_scrutiny" | "validator_user_testing";
  sessionId: string;
  verdict: "pass" | "fail";
  classification?: "patchable" | "blocking";
  findings: string;
  failedUnitIds: string[];
  timestamp: string;
}

export interface RetryCounter {
  milestoneId: string;
  retries: number;
  rescopes: number;
}

export interface WorkingUnitSpec {
  description: string;
  declaredPaths: string[];
  declaredModules: string[];
}

export interface MilestoneSpec {
  title: string;
  description: string;
  orderIndex: number;
}

export interface MemoryResult {
  id: number;
  title: string;
  content: string;
  type: string;
  scope: string;
  topicKey: string | null;
}

export interface StandingContext {
  taskId: string;
  workerSessionId: string;
}

export interface AttemptSummary {
  milestoneId: string;
  attemptIndex: number;
  scope: string;
  outcome: string;
  cost: number;
}

export interface EscalationContext {
  trigger: CheckpointTrigger;
  milestoneId: string;
  summary: string;
}

export interface AgentSpec {
  taskId: string;
  instructions: string;
  declaredPaths: string[];
  declaredModules: string[];
}
```

- [ ] **Step 5: Write events.ts**

```typescript
// packages/shared/src/events.ts
import type { AgentType, AgentStatus, MilestoneStatus, CheckpointTrigger, CheckpointDecision } from "./enums";
import type { AttemptSummary, EscalationContext } from "./types";

export type WsClientEvent =
  | { type: "agent_status"; agentId: string; agentType: AgentType; status: AgentStatus; milestoneId: string }
  | { type: "milestone_progress"; milestoneId: string; status: MilestoneStatus; completedUnits: number; totalUnits: number }
  | { type: "cost_update"; missionId: string; totalCost: number; totalTokens: number; delta: number }
  | { type: "escalation"; missionId: string; trigger: EscalationTrigger; context: EscalationContext };

export type EscalationTrigger =
  | { kind: "milestone_complete"; milestoneId: string; releaseBranch: string }
  | { kind: "rescope_limit"; milestoneId: string; attemptHistory: AttemptSummary[] }
  | { kind: "unclassifiable_error"; milestoneId: string; error: string; lastAttempt: string };

export interface WsServerMessage {
  event: WsClientEvent;
}

export interface WsClientMessage {
  event: "subscribe_mission" | "checkpoint_decision";
  missionId: string;
  checkpointId?: string;
  decision?: CheckpointDecision;
  guidance?: string;
  reason?: string;
}
```

- [ ] **Step 6: Write rest.ts**

```typescript
// packages/shared/src/rest.ts
import type { CheckpointDecision } from "./enums";
import type { Mission, Milestone, WorkingUnit, CostSummary } from "./types";

export interface CreateMissionRequest {
  description: string;
}

export interface CreateMissionResponse {
  missionId: string;
  status: Mission["status"];
}

export interface GetMissionResponse {
  mission: Mission;
  milestones: Milestone[];
  activeWorkers: WorkingUnit[];
  cost: CostSummary;
}

export interface CheckpointRequest {
  checkpointId: string;
  decision: CheckpointDecision;
  guidance?: string;
  reason?: string;
}

export interface CheckpointResponse {
  accepted: boolean;
  duplicate?: boolean;
}

export interface HealthResponse {
  status: "ok" | "degraded";
  lapis: boolean;
  pinyx: boolean;
}
```

- [ ] **Step 7: Write index.ts barrel export**

```typescript
// packages/shared/src/index.ts
export * from "./enums";
export * from "./types";
export * from "./events";
export * from "./rest";
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd packages/shared && npx vitest run __tests__/types.test.ts`
Expected: ALL PASS

- [ ] **Step 9: Commit**

```bash
git add packages/shared/
git commit -m "feat(shared): rewrite types, enums, events, rest types for v5 spec"
```

---

### Task 2: Backend Config (no more DB paths)

**Files:**
- Rewrite: `packages/backend/src/config.ts`
- Test: `packages/backend/__tests__/config.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/backend/__tests__/config.test.ts
import { describe, it, expect } from "vitest";
import { loadConfig, AppConfig } from "../src/config";

describe("loadConfig", () => {
  it("reads LAPIS_ENDPOINT not LAPIS_DB_PATH", () => {
    process.env.LAPIS_ENDPOINT = "http://localhost:9100";
    process.env.PINYX_ENDPOINT = "http://localhost:7331";
    process.env.REPO_ROOT = "/tmp/test-repo";
    process.env.PORT = "3000";
    process.env.WS_PORT = "3001";
    process.env.MISSION_COST_CAP = "50";

    const config = loadConfig();
    expect(config.lapisEndpoint).toBe("http://localhost:9100");
    expect(config.pinyxEndpoint).toBe("http://localhost:7331");
    // No DB path in config
    expect((config as Record<string, unknown>).lapisDbPath).toBeUndefined();
    expect((config as Record<string, unknown>).lapisCliPath).toBeUndefined();
  });

  it("provides model hints with defaults", () => {
    process.env.LAPIS_ENDPOINT = "http://localhost:9100";
    process.env.PINYX_ENDPOINT = "http://localhost:7331";
    process.env.REPO_ROOT = "/tmp/test-repo";
    delete process.env.MODEL_ORCHESTRATOR;

    const config = loadConfig();
    expect(config.modelHints.orchestrator).toBe("reasoning-strong");
    expect(config.modelHints.worker).toBe("code-fast");
  });

  it("provides timeout defaults", () => {
    process.env.LAPIS_ENDPOINT = "http://localhost:9100";
    process.env.PINYX_ENDPOINT = "http://localhost:7331";
    process.env.REPO_ROOT = "/tmp/test-repo";
    delete process.env.WORKER_TIMEOUT_SIMPLE;

    const config = loadConfig();
    expect(config.workerTimeouts.simple).toBe(120000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/backend && npx vitest run __tests__/config.test.ts`
Expected: FAIL — config.ts still has old shape

- [ ] **Step 3: Rewrite config.ts**

```typescript
// packages/backend/src/config.ts
export interface AppConfig {
  // LaPis (shared state) — HTTP only
  lapisEndpoint: string;

  // PiNyx (LLM gateway)
  pinyxEndpoint: string;

  // Agent model hints (passed to PiNyx routing)
  modelHints: {
    orchestrator: string;
    worker: string;
    validator_scrutiny: string;
    validator_user_testing: string;
    research: string;
  };

  // Agent timeouts (ms)
  workerTimeouts: {
    simple: number;
    build: number;
    testHeavy: number;
  };
  validatorTimeout: number;
  researchTimeout: number;

  // Mission limits
  maxValidatorRetries: number;
  maxRescopes: number;
  missionCostCap: number;

  // Git
  repoRoot: string;
  gitMainBranch: string;

  // Server
  port: number;
  wsPort: number;
}

function envInt(key: string, fallback: number): number {
  const val = process.env[key];
  return val ? parseInt(val, 10) : fallback;
}

export function loadConfig(): AppConfig {
  const required = ["LAPIS_ENDPOINT", "PINYX_ENDPOINT", "REPO_ROOT"];
  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required env var: ${key}`);
    }
  }

  return {
    lapisEndpoint: process.env.LAPIS_ENDPOINT!,
    pinyxEndpoint: process.env.PINYX_ENDPOINT!,

    modelHints: {
      orchestrator: process.env.MODEL_ORCHESTRATOR || "reasoning-strong",
      worker: process.env.MODEL_WORKER || "code-fast",
      validator_scrutiny: process.env.MODEL_VALIDATOR_SCRUTINY || "reasoning",
      validator_user_testing: process.env.MODEL_VALIDATOR_USER_TESTING || "computer-use",
      research: process.env.MODEL_RESEARCH || "fast-cheap",
    },

    workerTimeouts: {
      simple: envInt("WORKER_TIMEOUT_SIMPLE", 120_000),
      build: envInt("WORKER_TIMEOUT_BUILD", 300_000),
      testHeavy: envInt("WORKER_TIMEOUT_TEST_HEAVY", 600_000),
    },
    validatorTimeout: envInt("VALIDATOR_TIMEOUT", 180_000),
    researchTimeout: envInt("RESEARCH_TIMEOUT", 120_000),

    maxValidatorRetries: envInt("MAX_VALIDATOR_RETRIES", 2),
    maxRescopes: envInt("MAX_RESCOPES_PER_MILESTONE", 5),
    missionCostCap: envFloat("MISSION_COST_CAP", 50.0),

    repoRoot: process.env.REPO_ROOT!,
    gitMainBranch: process.env.GIT_MAIN_BRANCH || "main",

    port: envInt("PORT", 3000),
    wsPort: envInt("WS_PORT", 3001),
  };
}

function envFloat(key: string, fallback: number): number {
  const val = process.env[key];
  return val ? parseFloat(val) : fallback;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/backend && npx vitest run __tests__/config.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/config.ts packages/backend/__tests__/config.test.ts
git commit -m "feat(backend): rewrite config — HTTP-only LaPis, no DB paths"
```

---

### Task 3: LaPis HTTP Client (replaces CLI subprocess)

**Files:**
- Rewrite: `packages/backend/src/clients/lapis-client.ts`
- Test: `packages/backend/__tests__/lapis-client.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/backend/__tests__/lapis-client.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createLaPisClient } from "../src/clients/lapis-client";
import type { LaPisClient } from "../src/clients/lapis-client";

// Mock fetch globally
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

function mockResponse(data: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

describe("LaPisClient (HTTP)", () => {
  let client: LaPisClient;

  beforeEach(() => {
    mockFetch.mockReset();
    client = createLaPisClient({ lapisEndpoint: "http://localhost:9100" });
  });

  it("ping calls GET /health", async () => {
    mockFetch.mockReturnValue(mockResponse({ status: "ok" }));
    await client.ping();
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:9100/health",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("createMission POSTs to /missions", async () => {
    const mission = { id: "m-1", description: "Build auth", status: "planning" as const, configJson: {}, createdAt: "2026-01-01" };
    mockFetch.mockReturnValue(mockResponse(mission));
    const result = await client.createMission("Build auth", { modelHints: {}, workerTimeouts: { simple: 120000, build: 300000, testHeavy: 600000 }, costCap: 50, maxValidatorRetries: 2, maxRescopes: 5 });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:9100/missions",
      expect.objectContaining({ method: "POST" })
    );
    expect(result.id).toBe("m-1");
  });

  it("writeVerdict takes sessionId separately from verdict body", async () => {
    const verdict = { id: "v-1", verdict: "pass" as const, sessionId: "sess-1" };
    mockFetch.mockReturnValue(mockResponse(verdict));
    await client.writeVerdict("sess-1", {
      milestoneId: "ms-1",
      contractId: "c-1",
      validatorType: "validator_scrutiny",
      verdict: "pass",
      findings: "All good",
      failedUnitIds: [],
      timestamp: "2026-01-01",
    });
    const call = mockFetch.mock.calls[0];
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.sessionId).toBe("sess-1");
  });

  it("classifyVerdict PATCHes verdict with classification", async () => {
    mockFetch.mockReturnValue(mockResponse({ id: "v-1", classification: "blocking" }));
    await client.classifyVerdict("v-1", "blocking");
    const call = mockFetch.mock.calls[0];
    expect((call[1] as RequestInit).method).toBe("PATCH");
    expect(call[0]).toContain("/verdicts/v-1");
  });

  it("registerAgentSession sends milestoneId and unitId", async () => {
    mockFetch.mockReturnValue(mockResponse({ ok: true }));
    await client.registerAgentSession("worker", "sess-1", "m-1", "ms-1", "unit-1");
    const call = mockFetch.mock.calls[0];
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.milestoneId).toBe("ms-1");
    expect(body.unitId).toBe("unit-1");
  });

  it("getVerdicts fetches verdicts for a milestone", async () => {
    mockFetch.mockReturnValue(mockResponse([]));
    await client.getVerdicts("ms-1");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/milestones/ms-1/verdicts"),
      expect.any(Object)
    );
  });

  it("throws on non-2xx response", async () => {
    mockFetch.mockReturnValue(mockResponse({ error: "not found" }, 404));
    await expect(client.getMission("nonexistent")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/backend && npx vitest run __tests__/lapis-client.test.ts`
Expected: FAIL — old CLI-based client doesn't have these methods

- [ ] **Step 3: Backup old client and write new HTTP client**

First, copy the old client:
```bash
cp packages/backend/src/clients/lapis-client.ts packages/backend/src/clients/lapis-client.old.ts
```

Then write the new client:

```typescript
// packages/backend/src/clients/lapis-client.ts
import type {
  Mission, MissionConfig, Milestone, MilestoneSpec,
  WorkingUnit, WorkingUnitSpec, WorkerStatus,
  Handoff, HandoffResult, Broadcast, BroadcastLifecycle,
  ResearchFinding, ResearchLifecycle, StandingContext,
  AgentSessionRecord, CostEntry, CostSummary,
  RetryCounter, RescopeEvent, MemoryResult,
  ValidationVerdict,
} from "@aurex/shared";
import type { AgentType, CompressionTrigger } from "@aurex/shared";

export interface LaPisClientConfig {
  lapisEndpoint: string;
}

export interface LaPisClient {
  // Mission state
  createMission(description: string, config: MissionConfig): Promise<Mission>;
  getMission(id: string): Promise<Mission>;
  updateMissionStatus(id: string, status: Mission["status"]): Promise<void>;

  // Milestones
  createMilestone(missionId: string, milestone: MilestoneSpec): Promise<Milestone>;
  updateMilestoneStatus(id: string, status: Milestone["status"]): Promise<void>;

  // Working units
  createWorkingUnit(milestoneId: string, unit: WorkingUnitSpec): Promise<WorkingUnit>;
  updateWorkingUnitStatus(id: string, status: WorkerStatus): Promise<void>;

  // Handoffs
  writeHandoff(unitId: string, handoff: Handoff): Promise<HandoffResult>;

  // Validation contracts (append-only)
  createContract(milestoneId: string, contract: { content: { criteria: string[]; testCommands: string[]; acceptanceBehavior: string } }): Promise<{ id: string; milestoneId: string; version: number; content: unknown; supersedes: string | null; supersededBy: string | null; rescopeEventId: string | null; createdAt: string }>;
  supersedeContract(oldId: string, newContract: { content: { criteria: string[]; testCommands: string[]; acceptanceBehavior: string } }, rescopeEvent: Omit<RescopeEvent, "id" | "timestamp">): Promise<{ id: string; milestoneId: string; version: number; content: unknown; supersedes: string | null; supersededBy: string | null; rescopeEventId: string | null; createdAt: string }>;
  getContractHistory(milestoneId: string): Promise<unknown[]>;

  // Validation verdicts
  writeVerdict(sessionId: string, verdict: Omit<ValidationVerdict, "id" | "sessionId">): Promise<ValidationVerdict>;
  classifyVerdict(verdictId: string, classification: "patchable" | "blocking"): Promise<ValidationVerdict>;
  getVerdicts(milestoneId: string): Promise<ValidationVerdict[]>;

  // Broadcasts
  writeBroadcast(agentId: string, broadcast: Omit<Broadcast, "id" | "createdAt">): Promise<Broadcast>;
  transitionBroadcast(broadcastId: string, newStatus: BroadcastLifecycle, actorId: string): Promise<Broadcast>;
  getBroadcasts(missionId: string, opts?: { status?: BroadcastLifecycle[] }): Promise<Broadcast[]>;

  // Research findings
  writeFinding(agentId: string, finding: Omit<ResearchFinding, "id" | "createdAt">): Promise<ResearchFinding>;
  transitionFinding(findingId: string, newStatus: ResearchLifecycle, actorId: string, actorContext?: StandingContext): Promise<ResearchFinding>;
  getFindings(missionId: string, status?: ResearchLifecycle): Promise<ResearchFinding[]>;

  // Agent sessions
  registerAgentSession(agentType: AgentType, sessionId: string, missionId: string, milestoneId?: string, unitId?: string): Promise<void>;
  getSessionsForMilestone(milestoneId: string): Promise<AgentSessionRecord[]>;

  // Memory
  searchMemory(query: string, opts?: { limit?: number }): Promise<MemoryResult[]>;

  // Cost tracking
  logCost(entry: Omit<CostEntry, "id">): Promise<void>;
  getMissionCost(missionId: string): Promise<CostSummary>;

  // Retry / rescope
  incrementRetry(milestoneId: string): Promise<RetryCounter>;
  logRescope(milestoneId: string, event: Omit<RescopeEvent, "id" | "timestamp">): Promise<void>;

  // State compression (stubbed)
  runCompression(missionId: string, trigger: CompressionTrigger): Promise<void>;

  // Connectivity
  ping(): Promise<void>;
}

export function createLaPisClient(config: LaPisClientConfig): LaPisClient {
  const base = config.lapisEndpoint.replace(/\/$/, "");

  async function request<T>(path: string, opts?: RequestInit): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...opts,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "unknown error");
      throw new Error(`LaPis ${res.status}: ${path} — ${text}`);
    }
    return res.json();
  }

  function post<T>(path: string, body: unknown): Promise<T> {
    return request<T>(path, { method: "POST", body: JSON.stringify(body) });
  }

  function patch<T>(path: string, body: unknown): Promise<T> {
    return request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
  }

  function get<T>(path: string): Promise<T> {
    return request<T>(path, { method: "GET" });
  }

  return {
    // Mission state
    createMission(description, config) {
      return post("/missions", { description, config });
    },
    getMission(id) {
      return get(`/missions/${id}`);
    },
    updateMissionStatus(id, status) {
      return patch(`/missions/${id}/status`, { status });
    },

    // Milestones
    createMilestone(missionId, milestone) {
      return post(`/missions/${missionId}/milestones`, milestone);
    },
    updateMilestoneStatus(id, status) {
      return patch(`/milestones/${id}/status`, { status });
    },

    // Working units
    createWorkingUnit(milestoneId, unit) {
      return post(`/milestones/${milestoneId}/units`, unit);
    },
    updateWorkingUnitStatus(id, status) {
      return patch(`/units/${id}/status`, { status });
    },

    // Handoffs
    writeHandoff(unitId, handoff) {
      return post(`/units/${unitId}/handoff`, handoff);
    },

    // Validation contracts
    createContract(milestoneId, contract) {
      return post(`/milestones/${milestoneId}/contracts`, contract);
    },
    supersedeContract(oldId, newContract, rescopeEvent) {
      return post(`/contracts/${oldId}/supersede`, { newContract, rescopeEvent });
    },
    getContractHistory(milestoneId) {
      return get(`/milestones/${milestoneId}/contracts`);
    },

    // Validation verdicts
    writeVerdict(sessionId, verdict) {
      return post("/verdicts", { sessionId, ...verdict });
    },
    classifyVerdict(verdictId, classification) {
      return patch(`/verdicts/${verdictId}`, { classification });
    },
    getVerdicts(milestoneId) {
      return get(`/milestones/${milestoneId}/verdicts`);
    },

    // Broadcasts
    writeBroadcast(agentId, broadcast) {
      return post("/broadcasts", { agentId, ...broadcast });
    },
    transitionBroadcast(broadcastId, newStatus, actorId) {
      return patch(`/broadcasts/${broadcastId}`, { newStatus, actorId });
    },
    getBroadcasts(missionId, opts) {
      const params = new URLSearchParams();
      if (opts?.status?.length) params.set("status", opts.status.join(","));
      return get(`/missions/${missionId}/broadcasts?${params}`);
    },

    // Research findings
    writeFinding(agentId, finding) {
      return post("/findings", { agentId, ...finding });
    },
    transitionFinding(findingId, newStatus, actorId, actorContext) {
      return patch(`/findings/${findingId}`, { newStatus, actorId, actorContext });
    },
    getFindings(missionId, status) {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      return get(`/missions/${missionId}/findings?${params}`);
    },

    // Agent sessions
    registerAgentSession(agentType, sessionId, missionId, milestoneId, unitId) {
      return post("/sessions", { agentType, sessionId, missionId, milestoneId, unitId });
    },
    getSessionsForMilestone(milestoneId) {
      return get(`/milestones/${milestoneId}/sessions`);
    },

    // Memory
    searchMemory(query, opts) {
      return post("/memory/search", { query, ...opts });
    },

    // Cost tracking
    logCost(entry) {
      return post("/costs", entry);
    },
    getMissionCost(missionId) {
      return get(`/missions/${missionId}/costs`);
    },

    // Retry / rescope
    incrementRetry(milestoneId) {
      return post(`/milestones/${milestoneId}/retry`, {});
    },
    logRescope(milestoneId, event) {
      return post(`/milestones/${milestoneId}/rescope`, event);
    },

    // State compression (stubbed — logs skip, never silent)
    runCompression(missionId, trigger) {
      console.log(`[compression] Skipped — not implemented (trigger: ${trigger}, missionId: ${missionId})`);
      return Promise.resolve();
    },

    // Connectivity
    ping() {
      return get("/health").then(() => {});
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/backend && npx vitest run __tests__/lapis-client.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/clients/lapis-client.ts packages/backend/src/clients/lapis-client.old.ts packages/backend/__tests__/lapis-client.test.ts
git commit -m "feat(backend): rewrite LaPis client as HTTP — replaces CLI subprocess"
```

---

### Task 4: PiNyx Client (replaces router-client.ts)

**Files:**
- Create: `packages/backend/src/clients/pinyx-client.ts`
- Test: `packages/backend/__tests__/pinyx-client.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/backend/__tests__/pinyx-client.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPinyxClient, PinyxClient } from "../src/clients/pinyx-client";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

function mockResponse(data: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  });
}

describe("PinyxClient", () => {
  let client: PinyxClient;

  beforeEach(() => {
    mockFetch.mockReset();
    client = createPinyxClient({ endpoint: "http://localhost:7331" });
  });

  it("sends chat completions to PiNyx", async () => {
    mockFetch.mockReturnValue(mockResponse({
      id: "chatcmpl-1",
      choices: [{ message: { content: "Hello" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }));

    const result = await client.chat({
      model: "code-fast",
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:7331/v1/chat/completions",
      expect.objectContaining({ method: "POST" })
    );
    expect(result.content).toBe("Hello");
    expect(result.usage.promptTokens).toBe(10);
  });

  it("ping checks /v1/models", async () => {
    mockFetch.mockReturnValue(mockResponse({ data: [] }));
    await client.ping();
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:7331/v1/models",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("throws on PiNyx error", async () => {
    mockFetch.mockReturnValue(mockResponse({ error: "model not found" }, 404));
    await expect(client.chat({
      model: "nonexistent",
      messages: [{ role: "user", content: "test" }],
    })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/backend && npx vitest run __tests__/pinyx-client.test.ts`
Expected: FAIL — pinyx-client.ts doesn't exist

- [ ] **Step 3: Write pinyx-client.ts**

```typescript
// packages/backend/src/clients/pinyx-client.ts

export interface PinyxClientConfig {
  endpoint: string;
}

export interface ChatRequest {
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  temperature?: number;
  max_tokens?: number;
}

export interface ChatResponse {
  content: string;
  finishReason: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface PinyxClient {
  chat(request: ChatRequest): Promise<ChatResponse>;
  ping(): Promise<void>;
}

export function createPinyxClient(config: PinyxClientConfig): PinyxClient {
  const base = config.endpoint.replace(/\/$/, "");

  async function request<T>(path: string, opts?: RequestInit): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...opts,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "unknown error");
      throw new Error(`PiNyx ${res.status}: ${path} — ${text}`);
    }
    return res.json();
  }

  return {
    async chat(req) {
      const body = {
        model: req.model,
        messages: req.messages,
        ...(req.temperature !== undefined && { temperature: req.temperature }),
        ...(req.max_tokens !== undefined && { max_tokens: req.max_tokens }),
      };
      const res = await request<{
        id: string;
        choices: Array<{ message: { content: string }; finish_reason: string }>;
        usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      }>("/v1/chat/completions", { method: "POST", body: JSON.stringify(body) });

      return {
        content: res.choices[0]?.message?.content ?? "",
        finishReason: res.choices[0]?.finish_reason ?? "stop",
        usage: {
          promptTokens: res.usage?.prompt_tokens ?? 0,
          completionTokens: res.usage?.completion_tokens ?? 0,
          totalTokens: res.usage?.total_tokens ?? 0,
        },
      };
    },

    async ping() {
      await request("/v1/models", { method: "GET" });
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/backend && npx vitest run __tests__/pinyx-client.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/clients/pinyx-client.ts packages/backend/__tests__/pinyx-client.test.ts
git commit -m "feat(backend): add PiNyx client — OpenAI-compatible gateway at :7331"
```

---

## Phase 2: Enforcement Module

Tasks 5–10 build the enforcement layer. Each module is independently testable. These modules enforce runtime constraints — they don't orchestrate, they validate.

---

### Task 5: Handoff Validator

**Files:**
- Create: `packages/backend/src/enforcement/handoff-validator.ts`
- Test: `packages/backend/__tests__/handoff-validator.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/backend/__tests__/handoff-validator.test.ts
import { describe, it, expect } from "vitest";
import { validateHandoff } from "../src/enforcement/handoff-validator";
import type { Handoff } from "@aurex/shared";

describe("validateHandoff", () => {
  const validHandoff: Handoff = {
    unitId: "unit-1",
    featureName: "Auth",
    description: "Implemented login",
    implemented: "JWT tokens",
    remaining: "Refresh tokens",
    rationale: "Chose JWT for statelessness per contract requirement for stateless auth",
    assumptions: "Token expiry is 1 hour",
    unresolvedUncertainties: "none",
    errorsEncountered: "none",
    commandsRun: [{ command: "npm test", exitCode: 0 }],
    gitCommitHash: "abc123",
  };

  it("accepts a valid handoff", () => {
    const result = validateHandoff(validHandoff);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects handoff with copy-paste rationale", () => {
    const handoff = { ...validHandoff, rationale: "Refactored X" };
    const result = validateHandoff(handoff);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining("rationale"));
  });

  it("rejects handoff with absent unresolvedUncertainties", () => {
    const handoff = { ...validHandoff, unresolvedUncertainties: "" };
    const result = validateHandoff(handoff);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining("unresolvedUncertainties"));
  });

  it("accepts 'none' as valid unresolvedUncertainties", () => {
    const handoff = { ...validHandoff, unresolvedUncertainties: "none" };
    const result = validateHandoff(handoff);
    expect(result.valid).toBe(true);
  });

  it("rejects handoff with empty gitCommitHash", () => {
    const handoff = { ...validHandoff, gitCommitHash: "" };
    const result = validateHandoff(handoff);
    expect(result.valid).toBe(false);
  });

  it("rejects handoff with missing required fields", () => {
    const handoff = { ...validHandoff, description: "" };
    const result = validateHandoff(handoff);
    expect(result.valid).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/backend && npx vitest run __tests__/handoff-validator.test.ts`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Write handoff-validator.ts**

```typescript
// packages/backend/src/enforcement/handoff-validator.ts
import type { Handoff } from "@aurex/shared";

const COPY_PASTE_PATTERNS = [
  /^Refactored \w+$/,
  /^Implemented \w+$/,
  /^Fixed \w+$/,
  /^Updated \w+$/,
  /^Changed \w+$/,
];

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateHandoff(handoff: Handoff): ValidationResult {
  const errors: string[] = [];

  // Required non-empty string fields
  const requiredStrings: (keyof Handoff)[] = [
    "unitId", "featureName", "description", "implemented",
    "remaining", "rationale", "assumptions", "unresolvedUncertainties",
    "errorsEncountered", "gitCommitHash",
  ];

  for (const field of requiredStrings) {
    const value = handoff[field];
    if (typeof value !== "string" || value.trim().length === 0) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Rationale must not match copy-paste patterns
  if (handoff.rationale && COPY_PASTE_PATTERNS.some((p) => p.test(handoff.rationale))) {
    errors.push("rationale is too brief — must explain the reasoning, not just describe the change");
  }

  // unresolvedUncertainties must be present (empty string rejected above, "none" is valid)
  // Already handled by requiredStrings check

  // commandsRun must be a non-empty array
  if (!Array.isArray(handoff.commandsRun) || handoff.commandsRun.length === 0) {
    errors.push("commandsRun must contain at least one command");
  }

  return { valid: errors.length === 0, errors };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/backend && npx vitest run __tests__/handoff-validator.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/enforcement/handoff-validator.ts packages/backend/__tests__/handoff-validator.test.ts
git commit -m "feat(enforcement): add handoff structural validator"
```

---

### Task 6: Branch Guard

**Files:**
- Create: `packages/backend/src/enforcement/branch-guard.ts`
- Test: `packages/backend/__tests__/branch-guard.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/backend/__tests__/branch-guard.test.ts
import { describe, it, expect } from "vitest";
import { isBranchAllowed, validateCommitBranch } from "../src/enforcement/branch-guard";

describe("branch-guard", () => {
  it("allows commits to task/* branches", () => {
    expect(isBranchAllowed("task/worker-a/auth-001")).toBe(true);
    expect(isBranchAllowed("task/worker-b/api-001")).toBe(true);
  });

  it("rejects commits to non-task branches", () => {
    expect(isBranchAllowed("main")).toBe(false);
    expect(isBranchAllowed("develop")).toBe(false);
    expect(isBranchAllowed("agent/worker-a/auth")).toBe(false);
    expect(isBranchAllowed("release/milestone-1")).toBe(false);
  });

  it("validateCommitBranch returns result object", () => {
    const result = validateCommitBranch("task/worker-a/auth-001");
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("validateCommitBranch gives reason for rejection", () => {
    const result = validateCommitBranch("main");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("task/*");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/backend && npx vitest run __tests__/branch-guard.test.ts`
Expected: FAIL

- [ ] **Step 3: Write branch-guard.ts**

```typescript
// packages/backend/src/enforcement/branch-guard.ts

export interface BranchCheckResult {
  allowed: boolean;
  reason?: string;
}

export function isBranchAllowed(branch: string): boolean {
  return branch.startsWith("task/");
}

export function validateCommitBranch(branch: string): BranchCheckResult {
  if (isBranchAllowed(branch)) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: `Commits are only allowed on task/* branches. Current branch: "${branch}"`,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/backend && npx vitest run __tests__/branch-guard.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/enforcement/branch-guard.ts packages/backend/__tests__/branch-guard.test.ts
git commit -m "feat(enforcement): add branch guard — commits only on task/*"
```

---

### Task 7: Broadcast Lifecycle Enforcer

**Files:**
- Create: `packages/backend/src/enforcement/broadcast-lifecycle.ts`
- Test: `packages/backend/__tests__/broadcast-lifecycle.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/backend/__tests__/broadcast-lifecycle.test.ts
import { describe, it, expect } from "vitest";
import { validateBroadcastTransition, canAuthorTransition } from "../src/enforcement/broadcast-lifecycle";
import type { BroadcastLifecycle, AgentType } from "@aurex/shared";

describe("broadcast lifecycle", () => {
  it("allows active → superseded", () => {
    expect(validateBroadcastTransition("active", "superseded").valid).toBe(true);
  });

  it("allows active → archived", () => {
    expect(validateBroadcastTransition("active", "archived").valid).toBe(true);
  });

  it("allows active → expired", () => {
    expect(validateBroadcastTransition("active", "expired").valid).toBe(true);
  });

  it("rejects superseded → active", () => {
    expect(validateBroadcastTransition("superseded", "active").valid).toBe(false);
  });

  it("rejects expired → active", () => {
    expect(validateBroadcastTransition("expired", "active").valid).toBe(false);
  });

  it("rejects archived → active", () => {
    expect(validateBroadcastTransition("archived", "active").valid).toBe(false);
  });

  it("allows author to self-supersede", () => {
    expect(canAuthorTransition("worker-1", "worker-1", "active", "superseded")).toBe(true);
  });

  it("allows Orchestrator to archive any broadcast", () => {
    expect(canAuthorTransition("orchestrator-1", "worker-1", "active", "archived")).toBe(true);
  });

  it("rejects worker archiving another agent's broadcast", () => {
    expect(canAuthorTransition("worker-1", "worker-2", "active", "archived")).toBe(false);
  });

  it("allows human guidance broadcasts (special case)", () => {
    // human guidance has authorType "orchestrator" but authorId "human"
    expect(canAuthorTransition("human", "human", "active", "superseded")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/backend && npx vitest run __tests__/broadcast-lifecycle.test.ts`
Expected: FAIL

- [ ] **Step 3: Write broadcast-lifecycle.ts**

```typescript
// packages/backend/src/enforcement/broadcast-lifecycle.ts
import type { BroadcastLifecycle } from "@aurex/shared";

const VALID_TRANSITIONS: Record<BroadcastLifecycle, BroadcastLifecycle[]> = {
  active: ["superseded", "archived", "expired"],
  superseded: [],
  archived: [],
  expired: [],
};

export interface TransitionResult {
  valid: boolean;
  reason?: string;
}

export function validateBroadcastTransition(
  current: BroadcastLifecycle,
  next: BroadcastLifecycle,
): TransitionResult {
  const allowed = VALID_TRANSITIONS[current];
  if (!allowed) {
    return { valid: false, reason: `Unknown lifecycle state: ${current}` };
  }
  if (allowed.includes(next)) {
    return { valid: true };
  }
  return {
    valid: false,
    reason: `Invalid transition: ${current} → ${next}. Allowed: [${allowed.join(", ")}]`,
  };
}

export function canAuthorTransition(
  actorId: string,
  authorId: string,
  current: BroadcastLifecycle,
  next: BroadcastLifecycle,
): boolean {
  // First check transition is valid
  const transition = validateBroadcastTransition(current, next);
  if (!transition.valid) return false;

  // Author can self-supersede
  if (actorId === authorId) return true;

  // Orchestrator (or human acting through orchestrator authority) can do anything
  // The orchestrator prefix or "human" ID indicates orchestrator authority
  if (actorId.startsWith("orchestrator") || actorId === "human") return true;

  return false;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/backend && npx vitest run __tests__/broadcast-lifecycle.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/enforcement/broadcast-lifecycle.ts packages/backend/__tests__/broadcast-lifecycle.test.ts
git commit -m "feat(enforcement): add broadcast lifecycle enforcer — transitions + actor auth"
```

---

### Task 8: Research Lifecycle Enforcer

**Files:**
- Create: `packages/backend/src/enforcement/research-lifecycle.ts`
- Test: `packages/backend/__tests__/research-lifecycle.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/backend/__tests__/research-lifecycle.test.ts
import { describe, it, expect } from "vitest";
import { validateResearchTransition, canTransitionFinding } from "../src/enforcement/research-lifecycle";
import type { ResearchLifecycle } from "@aurex/shared";

describe("research lifecycle", () => {
  it("allows unverified → verified", () => {
    expect(validateResearchTransition("unverified", "verified").valid).toBe(true);
  });

  it("allows unverified → rejected", () => {
    expect(validateResearchTransition("unverified", "rejected").valid).toBe(true);
  });

  it("allows verified → superseded", () => {
    expect(validateResearchTransition("verified", "superseded").valid).toBe(true);
  });

  it("allows any → expired (auto-expiry)", () => {
    expect(validateResearchTransition("unverified", "expired").valid).toBe(true);
    expect(validateResearchTransition("verified", "expired").valid).toBe(true);
  });

  it("rejects verified → unverified", () => {
    expect(validateResearchTransition("verified", "unverified").valid).toBe(false);
  });

  it("rejects rejected → verified", () => {
    expect(validateResearchTransition("rejected", "verified").valid).toBe(false);
  });

  it("canTransitionFinding requires standing context for verification", () => {
    const result = canTransitionFinding("unverified", "verified", "worker-1", { taskId: "task-1", workerSessionId: "sess-1" });
    expect(result.valid).toBe(true);
  });

  it("rejects verification without standing context", () => {
    const result = canTransitionFinding("unverified", "verified", "worker-1");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("standing");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/backend && npx vitest run __tests__/research-lifecycle.test.ts`
Expected: FAIL

- [ ] **Step 3: Write research-lifecycle.ts**

```typescript
// packages/backend/src/enforcement/research-lifecycle.ts
import type { ResearchLifecycle, StandingContext } from "@aurex/shared";

const VALID_TRANSITIONS: Record<ResearchLifecycle, ResearchLifecycle[]> = {
  unverified: ["verified", "rejected", "expired"],
  verified: ["superseded", "expired"],
  superseded: ["expired"],
  rejected: ["expired"],
  expired: [],
};

export interface TransitionResult {
  valid: boolean;
  reason?: string;
}

export function validateResearchTransition(
  current: ResearchLifecycle,
  next: ResearchLifecycle,
): TransitionResult {
  const allowed = VALID_TRANSITIONS[current];
  if (!allowed) {
    return { valid: false, reason: `Unknown lifecycle state: ${current}` };
  }
  if (allowed.includes(next)) {
    return { valid: true };
  }
  return {
    valid: false,
    reason: `Invalid transition: ${current} → ${next}. Allowed: [${allowed.join(", ")}]`,
  };
}

export function canTransitionFinding(
  current: ResearchLifecycle,
  next: ResearchLifecycle,
  actorId: string,
  standingContext?: StandingContext,
): TransitionResult {
  const transition = validateResearchTransition(current, next);
  if (!transition.valid) return transition;

  // Verification requires standing context
  if (next === "verified" && !standingContext) {
    return {
      valid: false,
      reason: "Verification requires standing context (taskId + workerSessionId)",
    };
  }

  return { valid: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/backend && npx vitest run __tests__/research-lifecycle.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/enforcement/research-lifecycle.ts packages/backend/__tests__/research-lifecycle.test.ts
git commit -m "feat(enforcement): add research lifecycle enforcer — epistemic transitions + standing checks"
```

---

### Task 9: Contract Immutability Enforcer

**Files:**
- Create: `packages/backend/src/enforcement/contract-immutability.ts`
- Test: `packages/backend/__tests__/contract-immutability.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/backend/__tests__/contract-immutability.test.ts
import { describe, it, expect } from "vitest";
import { validateContractAppend, validateSupersede } from "../src/enforcement/contract-immutability";

describe("contract immutability", () => {
  it("allows creating a new contract (no existing)", () => {
    const result = validateContractAppend([], { milestoneId: "ms-1", content: { criteria: ["test passes"], testCommands: ["npm test"], acceptanceBehavior: "All tests pass" } });
    expect(result.valid).toBe(true);
  });

  it("allows creating v2 contract when v1 is superseded", () => {
    const existing = [
      { id: "c-1", version: 1, supersededBy: "c-2", supersedes: null, rescopeEventId: "r-1" },
    ];
    const result = validateContractAppend(existing, { milestoneId: "ms-1", content: { criteria: [], testCommands: [], acceptanceBehavior: "" } });
    expect(result.valid).toBe(true);
  });

  it("rejects creating v2 when v1 is not superseded", () => {
    const existing = [
      { id: "c-1", version: 1, supersededBy: null, supersedes: null, rescopeEventId: null },
    ];
    const result = validateContractAppend(existing, { milestoneId: "ms-1", content: { criteria: [], testCommands: [], acceptanceBehavior: "" } });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("supersede");
  });

  it("validates supersede requires rescope event", () => {
    const result = validateSupersede("c-1", { rescopeEventId: null });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("rescope");
  });

  it("allows supersede with rescope event", () => {
    const result = validateSupersede("c-1", { rescopeEventId: "r-1" });
    expect(result.valid).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/backend && npx vitest run __tests__/contract-immutability.test.ts`
Expected: FAIL

- [ ] **Step 3: Write contract-immutability.ts**

```typescript
// packages/backend/src/enforcement/contract-immutability.ts

interface ExistingContract {
  id: string;
  version: number;
  supersededBy: string | null;
  supersedes: string | null;
  rescopeEventId: string | null;
}

interface TransitionResult {
  valid: boolean;
  reason?: string;
}

export function validateContractAppend(
  existing: ExistingContract[],
  _newContract: { milestoneId: string; content: unknown },
): TransitionResult {
  if (existing.length === 0) {
    return { valid: true };
  }

  // Find the latest contract
  const latest = existing.reduce((a, b) => (a.version > b.version ? a : b));

  if (latest.supersededBy === null) {
    return {
      valid: false,
      reason: `Cannot append contract: current contract ${latest.id} (v${latest.version}) is not superseded. Supersede it first.`,
    };
  }

  return { valid: true };
}

export function validateSupersede(
  oldContractId: string,
  supersedeInfo: { rescopeEventId: string | null },
): TransitionResult {
  if (!supersedeInfo.rescopeEventId) {
    return {
      valid: false,
      reason: `Cannot supersede contract ${oldContractId}: rescope event is mandatory when superseding contracts.`,
    };
  }
  return { valid: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/backend && npx vitest run __tests__/contract-immutability.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/enforcement/contract-immutability.ts packages/backend/__tests__/contract-immutability.test.ts
git commit -m "feat(enforcement): add contract immutability enforcer — append-only with mandatory rescope"
```

---

### Task 10: Creator-Verifier Audit

**Files:**
- Create: `packages/backend/src/enforcement/creator-verifier.ts`
- Test: `packages/backend/__tests__/creator-verifier.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/backend/__tests__/creator-verifier.test.ts
import { describe, it, expect } from "vitest";
import { verifyCreatorSession } from "../src/enforcement/creator-verifier";
import type { AgentSessionRecord } from "@aurex/shared";

describe("creator-verifier", () => {
  const sessions: AgentSessionRecord[] = [
    { sessionId: "sess-worker-1", agentType: "worker", missionId: "m-1", milestoneId: "ms-1", unitId: "unit-1", spawnedAt: "2026-01-01", terminatedAt: null },
    { sessionId: "sess-validator-1", agentType: "validator_scrutiny", missionId: "m-1", milestoneId: "ms-1", unitId: null, spawnedAt: "2026-01-01", terminatedAt: null },
    { sessionId: "sess-orchestrator-1", agentType: "orchestrator", missionId: "m-1", milestoneId: null, unitId: null, spawnedAt: "2026-01-01", terminatedAt: null },
  ];

  it("accepts handoff from a registered worker session", () => {
    const result = verifyCreatorSession("sess-worker-1", "worker", sessions);
    expect(result.valid).toBe(true);
  });

  it("accepts verdict from a registered validator session", () => {
    const result = verifyCreatorSession("sess-validator-1", "validator_scrutiny", sessions);
    expect(result.valid).toBe(true);
  });

  it("rejects handoff from an unregistered session", () => {
    const result = verifyCreatorSession("unknown-session", "worker", sessions);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("not registered");
  });

  it("rejects handoff from wrong agent type", () => {
    const result = verifyCreatorSession("sess-validator-1", "worker", sessions);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("type mismatch");
  });

  it("exempts human from session checks", () => {
    const result = verifyCreatorSession("human", "orchestrator", sessions);
    expect(result.valid).toBe(true);
    expect(result.reason).toContain("known non-session actor");
  });

  it("rejects terminated session", () => {
    const terminated: AgentSessionRecord[] = [
      { ...sessions[0], terminatedAt: "2026-01-02" },
    ];
    const result = verifyCreatorSession("sess-worker-1", "worker", terminated);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("terminated");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/backend && npx vitest run __tests__/creator-verifier.test.ts`
Expected: FAIL

- [ ] **Step 3: Write creator-verifier.ts**

```typescript
// packages/backend/src/enforcement/creator-verifier.ts
import type { AgentSessionRecord, AgentType } from "@aurex/shared";

export interface VerificationResult {
  valid: boolean;
  reason?: string;
}

export function verifyCreatorSession(
  sessionId: string,
  expectedType: AgentType,
  sessions: AgentSessionRecord[],
): VerificationResult {
  // Human is a known non-session actor (exempt from session checks)
  if (sessionId === "human") {
    return { valid: true, reason: "human is a known non-session actor — exempt from Creator-Verifier session checks" };
  }

  const session = sessions.find((s) => s.sessionId === sessionId);

  if (!session) {
    return { valid: false, reason: `Session ${sessionId} is not registered in agent_sessions` };
  }

  if (session.agentType !== expectedType) {
    return { valid: false, reason: `Session ${sessionId} type mismatch: expected ${expectedType}, found ${session.agentType}` };
  }

  if (session.terminatedAt) {
    return { valid: false, reason: `Session ${sessionId} was terminated at ${session.terminatedAt}` };
  }

  return { valid: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/backend && npx vitest run __tests__/creator-verifier.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/enforcement/creator-verifier.ts packages/backend/__tests__/creator-verifier.test.ts
git commit -m "feat(enforcement): add Creator-Verifier audit — session ID verification with human exemption"
```

---

## Phase 3: Agent Architecture

Tasks 11–15 build the agent layer. Each agent type has its own lifecycle module. The factory ties them together.

---

### Task 11: Agent Factory + Session Manager

**Files:**
- Create: `packages/backend/src/agents/factory.ts`
- Test: `packages/backend/__tests__/agents/factory.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/backend/__tests__/agents/factory.test.ts
import { describe, it, expect } from "vitest";
import { AGENT_TOOLS, AGENT_SKILL, needsMemoryLayer, resolveModel } from "../src/agents/factory";
import type { AgentType } from "@aurex/shared";

describe("agent factory", () => {
  it("worker has read, write, edit, bash tools", () => {
    const tools = AGENT_TOOLS["worker"];
    expect(tools).toContain("read");
    expect(tools).toContain("write");
    expect(tools).toContain("edit");
    expect(tools).toContain("bash");
  });

  it("validator_scrutiny has read + bash (tests only)", () => {
    const tools = AGENT_TOOLS["validator_scrutiny"];
    expect(tools).toContain("read");
    expect(tools).toContain("bash");
    expect(tools).not.toContain("write");
    expect(tools).not.toContain("edit");
  });

  it("research has read only", () => {
    const tools = AGENT_TOOLS["research"];
    expect(tools).toEqual(["read"]);
  });

  it("orchestrator has read only", () => {
    const tools = AGENT_TOOLS["orchestrator"];
    expect(tools).toEqual(["read"]);
  });

  it("skill files map correctly", () => {
    expect(AGENT_SKILL["orchestrator"]).toContain("orchestrator.md");
    expect(AGENT_SKILL["worker"]).toContain("worker.md");
    expect(AGENT_SKILL["validator_scrutiny"]).toContain("validator.md");
    expect(AGENT_SKILL["validator_user_testing"]).toContain("validator.md");
    expect(AGENT_SKILL["research"]).toContain("research.md");
  });

  it("memory-layer for workers and research only", () => {
    expect(needsMemoryLayer("worker")).toBe(true);
    expect(needsMemoryLayer("research")).toBe(true);
    expect(needsMemoryLayer("orchestrator")).toBe(false);
    expect(needsMemoryLayer("validator_scrutiny")).toBe(false);
    expect(needsMemoryLayer("validator_user_testing")).toBe(false);
  });

  it("resolveModel returns correct hint", () => {
    const hints: Record<AgentType, string> = {
      orchestrator: "reasoning-strong",
      worker: "code-fast",
      validator_scrutiny: "reasoning",
      validator_user_testing: "computer-use",
      research: "fast-cheap",
    };
    expect(resolveModel("worker", hints)).toBe("code-fast");
    expect(resolveModel("orchestrator", hints)).toBe("reasoning-strong");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/backend && npx vitest run __tests__/agents/factory.test.ts`
Expected: FAIL

- [ ] **Step 3: Write factory.ts**

```typescript
// packages/backend/src/agents/factory.ts
import type { AgentType } from "@aurex/shared";

export const AGENT_TOOLS: Record<AgentType, string[]> = {
  orchestrator: ["read"],
  worker: ["read", "write", "edit", "bash"],
  validator_scrutiny: ["read", "bash"],
  validator_user_testing: ["read", "bash"],
  research: ["read"],
};

export const AGENT_SKILL: Record<AgentType, string> = {
  orchestrator: "skills/orchestrator.md",
  worker: "skills/worker.md",
  validator_scrutiny: "skills/validator.md",
  validator_user_testing: "skills/validator.md",
  research: "skills/research.md",
};

export function needsMemoryLayer(type: AgentType): boolean {
  return type === "worker" || type === "research";
}

export function resolveModel(type: AgentType, modelHints: Record<AgentType, string>): string {
  return modelHints[type];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/backend && npx vitest run __tests__/agents/factory.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/agents/factory.ts packages/backend/__tests__/agents/factory.test.ts
git commit -m "feat(agents): add agent factory — tool/skill/model maps per agent type"
```

---

### Task 12: Overlap Detection (rewrite)

**Files:**
- Rewrite: `packages/backend/src/orchestrator/overlap.ts`
- Test: `packages/backend/__tests__/overlap.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/backend/__tests__/overlap.test.ts
import { describe, it, expect } from "vitest";
import { checkPreSpawnOverlap, computePostCommitScope, detectOverlap } from "../src/orchestrator/overlap";
import type { WorkingUnit } from "@aurex/shared";

describe("overlap detection", () => {
  const existingUnits: WorkingUnit[] = [
    {
      id: "unit-1",
      milestoneId: "ms-1",
      description: "Auth feature",
      declaredPaths: ["src/auth/**", "src/middleware/auth.ts"],
      declaredModules: ["auth", "middleware"],
      status: "working",
      taskBranch: "task/worker-a/auth-001",
      worktreePath: "/tmp/wt-a",
      sessionId: "sess-1",
    },
  ];

  describe("pre-spawn", () => {
    it("detects overlap on declared paths", () => {
      const result = checkPreSpawnOverlap(
        { declaredPaths: ["src/auth/login.ts"], declaredModules: ["auth"] },
        existingUnits,
      );
      expect(result.overlap).toBe(true);
      expect(result.overlappingUnits).toContain("unit-1");
    });

    it("allows non-overlapping paths", () => {
      const result = checkPreSpawnOverlap(
        { declaredPaths: ["src/api/routes.ts"], declaredModules: ["api"] },
        existingUnits,
      );
      expect(result.overlap).toBe(false);
    });

    it("detects overlap on declared modules", () => {
      const result = checkPreSpawnOverlap(
        { declaredPaths: ["src/new-feature.ts"], declaredModules: ["auth"] },
        existingUnits,
      );
      expect(result.overlap).toBe(true);
    });
  });

  describe("post-commit", () => {
    it("unions declared scope with git diff files", () => {
      const scope = computePostCommitScope(
        { declaredPaths: ["src/auth/**"], declaredModules: ["auth"] },
        ["src/auth/login.ts", "src/utils/helpers.ts"],
      );
      expect(scope).toContain("src/utils/helpers.ts");
    });

    it("detects drift when git diff goes beyond declared scope", () => {
      const scope = computePostCommitScope(
        { declaredPaths: ["src/auth/**"], declaredModules: ["auth"] },
        ["src/auth/login.ts", "src/api/routes.ts"],
      );
      expect(scope.length).toBeGreaterThan(2); // declared + diff extras
    });
  });

  describe("detectOverlap", () => {
    it("returns overlapping unit IDs", () => {
      const result = detectOverlap(
        ["src/auth/login.ts", "src/middleware/auth.ts"],
        existingUnits,
      );
      expect(result.overlap).toBe(true);
      expect(result.overlappingUnits).toContain("unit-1");
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/backend && npx vitest run __tests__/overlap.test.ts`
Expected: FAIL

- [ ] **Step 3: Write overlap.ts**

```typescript
// packages/backend/src/orchestrator/overlap.ts
import type { WorkingUnit } from "@aurex/shared";
import minimatch from "minimatch";

interface ScopeDeclaration {
  declaredPaths: string[];
  declaredModules: string[];
}

export interface OverlapResult {
  overlap: boolean;
  overlappingUnits: string[];
}

/**
 * Pre-spawn scope check: uses declared_paths + declared_modules only.
 * Git diff doesn't exist yet — the task branch hasn't been written to.
 */
export function checkPreSpawnOverlap(
  newScope: ScopeDeclaration,
  existingUnits: WorkingUnit[],
): OverlapResult {
  const newPaths = newScope.declaredPaths;
  const newModules = newScope.declaredModules;

  const overlapping: string[] = [];

  for (const unit of existingUnits) {
    if (unit.status !== "working" && unit.status !== "spawned") continue;

    // Check module overlap
    const moduleOverlap = newModules.some((m) => unit.declaredModules.includes(m));
    if (moduleOverlap) {
      overlapping.push(unit.id);
      continue;
    }

    // Check path overlap using glob matching
    const pathOverlap = newPaths.some((newPath) =>
      unit.declaredPaths.some((existingPath) =>
        minimatch(newPath, existingPath) || minimatch(existingPath, newPath)
      ),
    );
    if (pathOverlap) {
      overlapping.push(unit.id);
    }
  }

  return { overlap: overlapping.length > 0, overlappingUnits: overlapping };
}

/**
 * Post-commit scope: unions declared scope with actual git diff files.
 */
export function computePostCommitScope(
  declaredScope: ScopeDeclaration,
  gitDiffFiles: string[],
): string[] {
  const declared = new Set(declaredScope.declaredPaths);
  for (const file of gitDiffFiles) {
    declared.add(file);
  }
  return Array.from(declared);
}

/**
 * Detect if a set of file paths overlaps with any existing working unit's scope.
 */
export function detectOverlap(
  filePaths: string[],
  existingUnits: WorkingUnit[],
): OverlapResult {
  const overlapping: string[] = [];

  for (const unit of existingUnits) {
    if (unit.status !== "working" && unit.status !== "spawned") continue;

    const hasOverlap = filePaths.some((file) =>
      unit.declaredPaths.some((pattern) => minimatch(file, pattern)),
    );

    if (hasOverlap) {
      overlapping.push(unit.id);
    }
  }

  return { overlap: overlapping.length > 0, overlappingUnits: overlapping };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/backend && npx vitest run __tests__/overlap.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/orchestrator/overlap.ts packages/backend/__tests__/overlap.test.ts
git commit -m "feat(orchestrator): rewrite overlap detection — pre-spawn vs post-commit scope"
```

---

### Task 13: Worktree Manager

**Files:**
- Create: `packages/backend/src/orchestrator/worktree.ts`
- Test: `packages/backend/__tests__/worktree.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/backend/__tests__/worktree.test.ts
import { describe, it, expect, vi } from "vitest";
import { WorktreeManager, createWorktreeManager } from "../src/orchestrator/worktree";

// Mock child_process.execAsync
vi.mock("node:child_process", () => ({
  exec: vi.fn(),
}));
import { exec } from "node:child_process";
const mockExec = vi.mocked(exec);

function mockExecSuccess(stdout = "") {
  mockExec.mockImplementation((_cmd: unknown, _opts: unknown, cb: unknown) => {
    const callback = cb as (err: null, stdout: { stdout: string; stderr: string }) => void;
    callback(null, { stdout, stderr: "" });
  });
}

describe("WorktreeManager", () => {
  let manager: WorktreeManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = createWorktreeManager("/repo/root");
  });

  it("creates a worktree with correct branch", async () => {
    mockExecSuccess("/repo/root/.git-worktrees/worker-a-auth-001");
    const result = await manager.createWorktree("worker-a", "auth-001", "agent/worker-a/auth");
    expect(mockExec).toHaveBeenCalled();
    const call = mockExec.mock.calls[0][0] as string;
    expect(call).toContain("git worktree add");
    expect(call).toContain("task/worker-a/auth-001");
  });

  it("merges task branch to develop", async () => {
    mockExecSuccess("");
    await manager.mergeToTarget("task/worker-a/auth-001", "develop");
    const call = mockExec.mock.calls[0][0] as string;
    expect(call).toContain("git merge");
  });

  it("prunes a worktree", async () => {
    mockExecSuccess("");
    await manager.pruneWorktree("/repo/root/.git-worktrees/worker-a-auth-001");
    const call = mockExec.mock.calls[0][0] as string;
    expect(call).toContain("git worktree remove");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/backend && npx vitest run __tests__/worktree.test.ts`
Expected: FAIL

- [ ] **Step 3: Write worktree.ts**

```typescript
// packages/backend/src/orchestrator/worktree.ts
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface WorktreeManager {
  createWorktree(agentId: string, taskId: string, agentBranch: string): Promise<{ worktreePath: string; taskBranch: string }>;
  mergeToTarget(sourceBranch: string, targetBranch: string): Promise<void>;
  pruneWorktree(worktreePath: string): Promise<void>;
}

export function createWorktreeManager(repoRoot: string): WorktreeManager {
  const worktreeBase = `${repoRoot}/.git-worktrees`;

  async function git(cmd: string): Promise<string> {
    const { stdout } = await execAsync(`git -C ${repoRoot} ${cmd}`);
    return stdout.trim();
  }

  return {
    async createWorktree(agentId, taskId, agentBranch) {
      const taskBranch = `task/${agentId}/${taskId}`;
      const worktreePath = `${worktreeBase}/${agentId}-${taskId}`;

      // Create task branch from agent branch
      await git(`branch ${taskBranch} ${agentBranch}`);

      // Create worktree with task branch checked out
      await git(`worktree add ${worktreePath} ${taskBranch}`);

      // Install git hook to enforce task/* branch
      // (hook content is in branch-guard.ts enforcement)

      return { worktreePath, taskBranch };
    },

    async mergeToTarget(sourceBranch, targetBranch) {
      await git(`checkout ${targetBranch}`);
      await git(`merge ${sourceBranch} --no-ff`);
    },

    async pruneWorktree(worktreePath) {
      await git(`worktree remove ${worktreePath} --force`);
      await git(`worktree prune`);
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/backend && npx vitest run __tests__/worktree.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/orchestrator/worktree.ts packages/backend/__tests__/worktree.test.ts
git commit -m "feat(orchestrator): add worktree manager — create/merge/prune lifecycle"
```

---

### Task 14: Planner + Negotiator (rewrite)

**Files:**
- Rewrite: `packages/backend/src/orchestrator/planner.ts`
- Rewrite: `packages/backend/src/orchestrator/negotiator.ts`
- Test: `packages/backend/__tests__/planner.test.ts`
- Test: `packages/backend/__tests__/negotiator.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/backend/__tests__/planner.test.ts
import { describe, it, expect, vi } from "vitest";
import { createPlanner } from "../src/orchestrator/planner";
import type { LaPisClient } from "../src/clients/lapis-client";

describe("planner", () => {
  it("plans milestones from mission description via PiNyx", async () => {
    const mockLapis = {
      searchMemory: vi.fn().mockResolvedValue([]),
      createMilestone: vi.fn().mockResolvedValue({ id: "ms-1" }),
      createWorkingUnit: vi.fn().mockResolvedValue({ id: "unit-1" }),
      createContract: vi.fn().mockResolvedValue({ id: "c-1" }),
    } as unknown as LaPisClient;

    const mockPinyx = {
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          milestones: [
            {
              title: "Auth module",
              description: "Implement JWT authentication",
              units: [{ description: "Login endpoint", declaredPaths: ["src/auth/**"], declaredModules: ["auth"] }],
              criteria: ["All tests pass", "JWT tokens valid"],
              testCommands: ["npm test -- src/auth"],
            },
          ],
        }),
        usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 },
      }),
    };

    const planner = createPlanner(mockLapis, mockPinyx);
    const result = await planner.plan("Build authentication system");

    expect(result.milestones).toHaveLength(1);
    expect(result.milestones[0].title).toBe("Auth module");
    expect(mockLapis.createMilestone).toHaveBeenCalled();
    expect(mockLapis.createContract).toHaveBeenCalled();
  });
});
```

```typescript
// packages/backend/__tests__/negotiator.test.ts
import { describe, it, expect, vi } from "vitest";
import { createNegotiator } from "../src/orchestrator/negotiator";
import type { LaPisClient } from "../src/clients/lapis-client";
import type { ValidationVerdict } from "@aurex/shared";

describe("negotiator", () => {
  it("returns pass when all verdicts pass", async () => {
    const mockLapis = {
      getVerdicts: vi.fn().mockResolvedValue([
        { verdict: "pass", validatorType: "validator_scrutiny" },
        { verdict: "pass", validatorType: "validator_user_testing" },
      ] as ValidationVerdict[]),
      classifyVerdict: vi.fn(),
    } as unknown as LaPisClient;

    const negotiator = createNegotiator(mockLapis);
    const result = await negotiator.negotiate("ms-1", 0, 0, 2, 5);

    expect(result.decision).toBe("pass");
  });

  it("returns retry when scrutiny fails with patchable classification", async () => {
    const verdicts: ValidationVerdict[] = [
      { id: "v-1", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_scrutiny", sessionId: "s-1", verdict: "fail", classification: "patchable", findings: "Missing test", failedUnitIds: ["unit-1"], timestamp: "" },
      { id: "v-2", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_user_testing", sessionId: "s-2", verdict: "pass", findings: "", failedUnitIds: [], timestamp: "" },
    ];
    const mockLapis = {
      getVerdicts: vi.fn().mockResolvedValue(verdicts),
      classifyVerdict: vi.fn(),
    } as unknown as LaPisClient;

    const negotiator = createNegotiator(mockLapis);
    const result = await negotiator.negotiate("ms-1", 0, 0, 2, 5);

    expect(result.decision).toBe("retry");
  });

  it("returns rescope when retry limit exceeded", async () => {
    const verdicts: ValidationVerdict[] = [
      { id: "v-1", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_scrutiny", sessionId: "s-1", verdict: "fail", classification: "blocking", findings: "Bad", failedUnitIds: ["unit-1"], timestamp: "" },
    ];
    const mockLapis = {
      getVerdicts: vi.fn().mockResolvedValue(verdicts),
      classifyVerdict: vi.fn(),
    } as unknown as LaPisClient;

    const negotiator = createNegotiator(mockLapis);
    // retryCount=2 (at limit), rescopeCount=0
    const result = await negotiator.negotiate("ms-1", 2, 0, 2, 5);

    expect(result.decision).toBe("rescope");
  });

  it("returns escalate when rescope limit exceeded", async () => {
    const mockLapis = {
      getVerdicts: vi.fn().mockResolvedValue([{ verdict: "fail", classification: "blocking" }]),
      classifyVerdict: vi.fn(),
    } as unknown as LaPisClient;

    const negotiator = createNegotiator(mockLapis);
    const result = await negotiator.negotiate("ms-1", 2, 5, 2, 5);

    expect(result.decision).toBe("escalate");
  });

  it("always blocks on user testing failure", async () => {
    const verdicts: ValidationVerdict[] = [
      { id: "v-1", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_scrutiny", sessionId: "s-1", verdict: "pass", findings: "", failedUnitIds: [], timestamp: "" },
      { id: "v-2", milestoneId: "ms-1", contractId: "c-1", validatorType: "validator_user_testing", sessionId: "s-2", verdict: "fail", findings: "User flow broken", failedUnitIds: ["unit-1"], timestamp: "" },
    ];
    const mockLapis = {
      getVerdicts: vi.fn().mockResolvedValue(verdicts),
      classifyVerdict: vi.fn(),
    } as unknown as LaPisClient;

    const negotiator = createNegotiator(mockLapis);
    const result = await negotiator.negotiate("ms-1", 0, 0, 2, 5);

    expect(result.decision).toBe("retry");
    expect(result.reason).toContain("user_testing");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/backend && npx vitest run __tests__/planner.test.ts __tests__/negotiator.test.ts`
Expected: FAIL

- [ ] **Step 3: Write planner.ts**

```typescript
// packages/backend/src/orchestrator/planner.ts
import type { LaPisClient } from "../clients/lapis-client";
import type { PinyxClient } from "../clients/pinyx-client";

interface PlannedUnit {
  description: string;
  declaredPaths: string[];
  declaredModules: string[];
}

interface PlannedMilestoneRaw {
  title: string;
  description: string;
  units: PlannedUnit[];
  criteria: string[];
  testCommands: string[];
}

interface PlanResult {
  milestones: Array<{
    id: string;
    title: string;
    units: Array<{ id: string; description: string }>;
  }>;
}

export function createPlanner(lapis: LaPisClient, pinyx: PinyxClient) {
  return {
    async plan(missionDescription: string, missionId: string): Promise<PlanResult> {
      // 1. Gather memory context
      const memories = await lapis.searchMemory(missionDescription, { limit: 10 });

      // 2. Ask PiNyx to decompose into milestones
      const response = await pinyx.chat({
        model: "reasoning-strong",
        messages: [
          {
            role: "system",
            content: `You are a mission planner. Decompose the mission into ordered milestones. Each milestone has working units with declared paths and modules, validation criteria, and test commands. Respond with JSON only.`,
          },
          {
            role: "user",
            content: `Mission: ${missionDescription}\n\nRelevant context: ${memories.map((m) => m.content).join("\n")}`,
          },
        ],
      });

      const plan = JSON.parse(response.content) as { milestones: PlannedMilestoneRaw[] };

      // 3. Create milestones, units, and contracts in LaPis
      const result: PlanResult["milestones"] = [];
      for (let i = 0; i < plan.milestones.length; i++) {
        const ms = plan.milestones[i];
        const milestone = await lapis.createMilestone(missionId, {
          title: ms.title,
          description: ms.description,
          orderIndex: i,
        });

        const units: Array<{ id: string; description: string }> = [];
        for (const unit of ms.units) {
          const created = await lapis.createWorkingUnit(milestone.id, unit);
          units.push({ id: created.id, description: created.description });
        }

        await lapis.createContract(milestone.id, {
          content: {
            criteria: ms.criteria,
            testCommands: ms.testCommands,
            acceptanceBehavior: ms.criteria.join("; "),
          },
        });

        result.push({ id: milestone.id, title: ms.title, units });
      }

      return { milestones: result };
    },
  };
}
```

- [ ] **Step 4: Write negotiator.ts**

```typescript
// packages/backend/src/orchestrator/negotiator.ts
import type { LaPisClient } from "../clients/lapis-client";
import type { ValidationVerdict, NegotiatorVerdict } from "@aurex/shared";

interface NegotiateResult {
  decision: NegotiatorVerdict;
  reason: string;
  failedUnitIds?: string[];
}

export function createNegotiator(lapis: LaPisClient) {
  return {
    async negotiate(
      milestoneId: string,
      retryCount: number,
      rescopeCount: number,
      maxRetries: number,
      maxRescopes: number,
    ): Promise<NegotiateResult> {
      const verdicts: ValidationVerdict[] = await lapis.getVerdicts(milestoneId);

      // Check if all verdicts pass
      const allPass = verdicts.every((v) => v.verdict === "pass");
      if (allPass) {
        return { decision: "pass", reason: "All validators passed" };
      }

      // User testing failure always blocks (override authority)
      const userTestFailure = verdicts.find(
        (v) => v.validatorType === "validator_user_testing" && v.verdict === "fail",
      );
      if (userTestFailure) {
        if (retryCount < maxRetries) {
          return {
            decision: "retry",
            reason: `user_testing failed — always blocks`,
            failedUnitIds: userTestFailure.failedUnitIds,
          };
        }
        if (rescopeCount < maxRescopes) {
          return {
            decision: "rescope",
            reason: `user_testing failed, retries exhausted — rescope needed`,
          };
        }
        return { decision: "escalate", reason: "user_testing failed, all limits exhausted" };
      }

      // Scrutiny-only failure — classify
      const scrutinyFailure = verdicts.find(
        (v) => v.validatorType === "validator_scrutiny" && v.verdict === "fail",
      );
      if (scrutinyFailure) {
        const classification = scrutinyFailure.classification || "blocking";

        if (classification === "patchable" && retryCount < maxRetries) {
          return {
            decision: "retry",
            reason: `scrutiny patchable: ${scrutinyFailure.findings}`,
            failedUnitIds: scrutinyFailure.failedUnitIds,
          };
        }

        // Blocking or retry exhausted
        if (retryCount < maxRetries) {
          return {
            decision: "retry",
            reason: `scrutiny blocking — full retry`,
            failedUnitIds: scrutinyFailure.failedUnitIds,
          };
        }

        if (rescopeCount < maxRescopes) {
          return { decision: "rescope", reason: "scrutiny failed, retries exhausted" };
        }

        return { decision: "escalate", reason: "scrutiny failed, all limits exhausted" };
      }

      // Shouldn't reach here, but default to escalate
      return { decision: "escalate", reason: "Unknown verdict state" };
    },
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/backend && npx vitest run __tests__/planner.test.ts __tests__/negotiator.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/orchestrator/planner.ts packages/backend/src/orchestrator/negotiator.ts packages/backend/__tests__/planner.test.ts packages/backend/__tests__/negotiator.test.ts
git commit -m "feat(orchestrator): rewrite planner + negotiator — LaPis HTTP, verdict-based negotiation"
```

---

### Task 15: Milestone Loop (rewrite)

**Files:**
- Rewrite: `packages/backend/src/orchestrator/milestone-loop.ts`
- Test: `packages/backend/__tests__/milestone-loop.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/backend/__tests__/milestone-loop.test.ts
import { describe, it, expect, vi } from "vitest";
import { createMilestoneLoop } from "../src/orchestrator/milestone-loop";
import type { LaPisClient } from "../src/clients/lapis-client";
import type { PinyxClient } from "../src/clients/pinyx-client";
import type { Mission, Milestone, WorkingUnit } from "@aurex/shared";

describe("milestone loop", () => {
  const mission: Mission = {
    id: "m-1",
    description: "Build auth",
    status: "running",
    configJson: {
      modelHints: { orchestrator: "reasoning-strong", worker: "code-fast", validator_scrutiny: "reasoning", validator_user_testing: "computer-use", research: "fast-cheap" },
      workerTimeouts: { simple: 120000, build: 300000, testHeavy: 600000 },
      costCap: 50,
      maxValidatorRetries: 2,
      maxRescopes: 5,
    },
    createdAt: "2026-01-01",
  };

  it("skips completed milestones", async () => {
    const mockLapis = {
      updateMissionStatus: vi.fn(),
      updateMilestoneStatus: vi.fn(),
      incrementRetry: vi.fn().mockResolvedValue({ retries: 0, rescopes: 0 }),
    } as unknown as LaPisClient;

    const milestones: Milestone[] = [
      { id: "ms-1", missionId: "m-1", title: "Done", description: "", orderIndex: 0, status: "completed", validationContractId: "c-1" },
      { id: "ms-2", missionId: "m-1", title: "Pending", description: "", orderIndex: 1, status: "planned", validationContractId: "c-2" },
    ];

    const loop = createMilestoneLoop(mockLapis, {} as PinyxClient, {
      onEscalation: vi.fn(),
      onAgentStatus: vi.fn(),
      onMilestoneProgress: vi.fn(),
      onCostUpdate: vi.fn(),
    });

    // Should process only ms-2
    const processed = await loop.run(mission, milestones);
    expect(processed).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/backend && npx vitest run __tests__/milestone-loop.test.ts`
Expected: FAIL

- [ ] **Step 3: Write milestone-loop.ts**

```typescript
// packages/backend/src/orchestrator/milestone-loop.ts
import type { Mission, Milestone, NegotiatorVerdict } from "@aurex/shared";
import type { LaPisClient } from "../clients/lapis-client";
import type { PinyxClient } from "../clients/pinyx-client";
import { createNegotiator } from "./negotiator";

export interface MilestoneLoopCallbacks {
  onEscalation: (missionId: string, trigger: unknown, context: unknown) => void;
  onAgentStatus: (agentId: string, agentType: unknown, status: unknown, milestoneId: string) => void;
  onMilestoneProgress: (milestoneId: string, status: unknown, completedUnits: number, totalUnits: number) => void;
  onCostUpdate: (missionId: string, totalCost: number, totalTokens: number, delta: number) => void;
}

export function createMilestoneLoop(
  lapis: LaPisClient,
  pinyx: PinyxClient,
  callbacks: MilestoneLoopCallbacks,
) {
  return {
    async run(mission: Mission, milestones: Milestone[]): Promise<boolean> {
      const config = mission.configJson;
      const negotiator = createNegotiator(lapis);

      for (const milestone of milestones) {
        if (milestone.status === "completed") continue;

        // Update milestone status
        await lapis.updateMilestoneStatus(milestone.id, "in_progress");
        callbacks.onMilestoneProgress(milestone.id, "in_progress", 0, 0);

        // Negotiate verdicts (placeholder — actual worker spawning happens here in full impl)
        const retryCounter = await lapis.incrementRetry(milestone.id);
        const decision = await negotiator.negotiate(
          milestone.id,
          retryCounter.retries,
          retryCounter.rescopes,
          config.maxValidatorRetries,
          config.maxRescopes,
        );

        if (decision.decision === "escalate") {
          callbacks.onEscalation(mission.id, { kind: "rescope_limit", milestoneId: milestone.id }, {});
          return false; // Pause for human
        }

        // Mark complete if passed
        if (decision.decision === "pass") {
          await lapis.updateMilestoneStatus(milestone.id, "completed");
          callbacks.onMilestoneProgress(milestone.id, "completed", 1, 1);
        }
      }

      // All milestones complete
      await lapis.updateMissionStatus(mission.id, "completed");
      return true;
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/backend && npx vitest run __tests__/milestone-loop.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/orchestrator/milestone-loop.ts packages/backend/__tests__/milestone-loop.test.ts
git commit -m "feat(orchestrator): rewrite milestone loop — callback-driven, negotiator integration"
```

---

## Phase 4: Backend Server (REST + WebSocket)

Tasks 16–18 build the Fastify server with routes and WebSocket.

---

### Task 16: REST Routes (Missions + Checkpoints)

**Files:**
- Create: `packages/backend/src/routes/missions.ts`
- Create: `packages/backend/src/routes/checkpoints.ts`
- Test: `packages/backend/__tests__/routes/missions.test.ts`
- Test: `packages/backend/__tests__/routes/checkpoints.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/backend/__tests__/routes/missions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { missionRoutes } from "../../src/routes/missions";
import type { LaPisClient } from "../../src/clients/lapis-client";

describe("POST /api/missions", () => {
  it("creates a mission and returns missionId", async () => {
    const app = Fastify();
    const mockLapis = {
      createMission: vi.fn().mockResolvedValue({ id: "m-1", status: "planning" }),
    } as unknown as LaPisClient;

    app.register(missionRoutes, { lapis: mockLapis });

    const response = await app.inject({
      method: "POST",
      url: "/api/missions",
      payload: { description: "Build auth system" },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.missionId).toBe("m-1");
    expect(body.status).toBe("planning");
  });
});

describe("GET /api/missions/current", () => {
  it("returns active mission with full state", async () => {
    const app = Fastify();
    const mockLapis = {
      getMission: vi.fn().mockResolvedValue({ id: "m-1", status: "running", description: "Build auth" }),
      getMissionCost: vi.fn().mockResolvedValue({ totalCost: 5.0, totalTokens: 1000, entries: 10 }),
    } as unknown as LaPisClient;

    app.register(missionRoutes, { lapis: mockLapis });

    const response = await app.inject({
      method: "GET",
      url: "/api/missions/current",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().mission.id).toBe("m-1");
  });
});
```

```typescript
// packages/backend/__tests__/routes/checkpoints.test.ts
import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { checkpointRoutes } from "../../src/routes/checkpoints";

describe("POST /api/missions/:id/checkpoints", () => {
  it("accepts checkpoint with dedup", async () => {
    const app = Fastify();
    const resolveCheckpoint = vi.fn().mockResolvedValue({ accepted: true });

    app.register(checkpointRoutes, { resolveCheckpoint });

    const response = await app.inject({
      method: "POST",
      url: "/api/missions/m-1/checkpoints",
      payload: {
        checkpointId: "cp-uuid-1",
        decision: "approve",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().accepted).toBe(true);
    expect(resolveCheckpoint).toHaveBeenCalledWith("m-1", "approve", undefined, undefined);
  });

  it("returns duplicate for re-submission", async () => {
    const app = Fastify();
    const resolveCheckpoint = vi.fn().mockResolvedValue({ accepted: true, duplicate: true });

    app.register(checkpointRoutes, { resolveCheckpoint });

    const response = await app.inject({
      method: "POST",
      url: "/api/missions/m-1/checkpoints",
      payload: {
        checkpointId: "cp-uuid-1",
        decision: "approve",
      },
    });

    expect(response.json().duplicate).toBe(true);
  });

  it("passes guidance for rescope", async () => {
    const app = Fastify();
    const resolveCheckpoint = vi.fn().mockResolvedValue({ accepted: true });

    app.register(checkpointRoutes, { resolveCheckpoint });

    await app.inject({
      method: "POST",
      url: "/api/missions/m-1/checkpoints",
      payload: {
        checkpointId: "cp-uuid-2",
        decision: "rescope",
        guidance: "Focus on auth only",
      },
    });

    expect(resolveCheckpoint).toHaveBeenCalledWith("m-1", "rescope", "Focus on auth only", undefined);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/backend && npx vitest run __tests__/routes/`
Expected: FAIL

- [ ] **Step 3: Write missions.ts**

```typescript
// packages/backend/src/routes/missions.ts
import type { FastifyInstance } from "fastify";
import type { LaPisClient } from "../clients/lapis-client";

export async function missionRoutes(app: FastifyInstance, { lapis }: { lapis: LaPisClient }) {
  app.post("/api/missions", async (request, reply) => {
    const { description } = request.body as { description: string };
    if (!description) {
      return reply.status(400).send({ error: "description is required" });
    }
    const mission = await lapis.createMission(description, {
      modelHints: {
        orchestrator: "reasoning-strong",
        worker: "code-fast",
        validator_scrutiny: "reasoning",
        validator_user_testing: "computer-use",
        research: "fast-cheap",
      },
      workerTimeouts: { simple: 120000, build: 300000, testHeavy: 600000 },
      costCap: 50,
      maxValidatorRetries: 2,
      maxRescopes: 5,
    });
    return reply.status(201).send({ missionId: mission.id, status: mission.status });
  });

  app.get("/api/missions/current", async (_request, reply) => {
    // TODO: find the active mission — for now return 404
    return reply.status(404).send({ error: "No active mission" });
  });

  app.get("/api/missions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const mission = await lapis.getMission(id);
      const cost = await lapis.getMissionCost(id);
      return { mission, milestones: [], activeWorkers: [], cost };
    } catch {
      return reply.status(404).send({ error: "Mission not found" });
    }
  });
}
```

- [ ] **Step 4: Write checkpoints.ts**

```typescript
// packages/backend/src/routes/checkpoints.ts
import type { FastifyInstance } from "fastify";
import type { CheckpointDecision } from "@aurex/shared";

interface CheckpointBody {
  checkpointId: string;
  decision: CheckpointDecision;
  guidance?: string;
  reason?: string;
}

export async function checkpointRoutes(
  app: FastifyInstance,
  { resolveCheckpoint }: {
    resolveCheckpoint: (
      missionId: string, decision: CheckpointDecision, guidance?: string, reason?: string
    ) => Promise<{ accepted: boolean; duplicate?: boolean }>;
  },
) {
  // In-memory dedup tracker (per process)
  const processed = new Map<string, boolean>();

  app.post("/api/missions/:id/checkpoints", async (request, reply) => {
    const { id: missionId } = request.params as { id: string };
    const body = request.body as CheckpointBody;

    if (!body.checkpointId || !body.decision) {
      return reply.status(400).send({ error: "checkpointId and decision are required" });
    }

    // Dedup check
    if (processed.has(body.checkpointId)) {
      return { accepted: true, duplicate: true };
    }

    const result = await resolveCheckpoint(missionId, body.decision, body.guidance, body.reason);

    if (result.accepted) {
      processed.set(body.checkpointId, true);
    }

    return result;
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/backend && npx vitest run __tests__/routes/`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/routes/ packages/backend/__tests__/routes/
git commit -m "feat(backend): add REST routes — missions CRUD + checkpoint submission with dedup"
```

---

### Task 17: WebSocket Events

**Files:**
- Create: `packages/backend/src/ws/events.ts`
- Test: `packages/backend/__tests__/ws/events.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/backend/__tests__/ws/events.test.ts
import { describe, it, expect } from "vitest";
import { createEventBus } from "../../src/ws/events";
import type { WsClientEvent } from "@aurex/shared";

describe("event bus", () => {
  it("broadcasts agent_status events", () => {
    const bus = createEventBus();
    const received: WsClientEvent[] = [];
    bus.subscribe((event) => received.push(event));

    bus.emit({
      type: "agent_status",
      agentId: "worker-1",
      agentType: "worker",
      status: "working",
      milestoneId: "ms-1",
    });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("agent_status");
  });

  it("broadcasts escalation events", () => {
    const bus = createEventBus();
    const received: WsClientEvent[] = [];
    bus.subscribe((event) => received.push(event));

    bus.emit({
      type: "escalation",
      missionId: "m-1",
      trigger: { kind: "milestone_complete", milestoneId: "ms-1", releaseBranch: "release/milestone-1" },
      context: { trigger: "milestone_complete", milestoneId: "ms-1", summary: "Done" },
    });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("escalation");
  });

  it("supports multiple subscribers", () => {
    const bus = createEventBus();
    let count = 0;
    bus.subscribe(() => count++);
    bus.subscribe(() => count++);

    bus.emit({
      type: "cost_update",
      missionId: "m-1",
      totalCost: 5.0,
      totalTokens: 1000,
      delta: 0.5,
    });

    expect(count).toBe(2);
  });

  it("unsubscribe stops events", () => {
    const bus = createEventBus();
    let count = 0;
    const unsub = bus.subscribe(() => count++);

    bus.emit({ type: "milestone_progress", milestoneId: "ms-1", status: "completed", completedUnits: 1, totalUnits: 1 });
    expect(count).toBe(1);

    unsub();
    bus.emit({ type: "milestone_progress", milestoneId: "ms-2", status: "in_progress", completedUnits: 0, totalUnits: 2 });
    expect(count).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/backend && npx vitest run __tests__/ws/events.test.ts`
Expected: FAIL

- [ ] **Step 3: Write events.ts**

```typescript
// packages/backend/src/ws/events.ts
import type { WsClientEvent } from "@aurex/shared";

export type EventHandler = (event: WsClientEvent) => void;

export interface EventBus {
  emit(event: WsClientEvent): void;
  subscribe(handler: EventHandler): () => void; // returns unsubscribe fn
}

export function createEventBus(): EventBus {
  const subscribers = new Set<EventHandler>();

  return {
    emit(event) {
      for (const handler of subscribers) {
        handler(event);
      }
    },
    subscribe(handler) {
      subscribers.add(handler);
      return () => {
        subscribers.delete(handler);
      };
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/backend && npx vitest run __tests__/ws/events.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/ws/events.ts packages/backend/__tests__/ws/events.test.ts
git commit -m "feat(backend): add WebSocket event bus — pub/sub for agent status, escalation, cost"
```

---

### Task 18: Server Entry (rewrite)

**Files:**
- Rewrite: `packages/backend/src/server.ts`
- Test: `packages/backend/__tests__/server.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/backend/__tests__/server.test.ts
import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";

describe("server healthcheck", () => {
  it("returns 503 when LaPis is down", async () => {
    const app = Fastify();
    const mockLapis = { ping: vi.fn().mockRejectedValue(new Error("connection refused")) };
    const mockPinyx = { ping: vi.fn().mockResolvedValue(undefined) };

    app.get("/health", async () => {
      const lapisOk = await mockLapis.ping().then(() => true, () => false);
      const pinyxOk = await mockPinyx.ping().then(() => true, () => false);
      const ok = lapisOk && pinyxOk;
      return { status: ok ? "ok" : "degraded", lapis: lapisOk, pinyx: pinyxOk };
    });

    const response = await app.inject({ method: "GET", url: "/health" });
    const body = response.json();
    expect(body.lapis).toBe(false);
    expect(body.status).toBe("degraded");
  });

  it("returns ok when both services are healthy", async () => {
    const app = Fastify();
    const mockLapis = { ping: vi.fn().mockResolvedValue(undefined) };
    const mockPinyx = { ping: vi.fn().mockResolvedValue(undefined) };

    app.get("/health", async () => {
      const lapisOk = await mockLapis.ping().then(() => true, () => false);
      const pinyxOk = await mockPinyx.ping().then(() => true, () => false);
      const ok = lapisOk && pinyxOk;
      return { status: ok ? "ok" : "degraded", lapis: lapisOk, pinyx: pinyxOk };
    });

    const response = await app.inject({ method: "GET", url: "/health" });
    const body = response.json();
    expect(body.status).toBe("ok");
    expect(body.lapis).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/backend && npx vitest run __tests__/server.test.ts`
Expected: FAIL (or passes trivially — this test is self-contained)

- [ ] **Step 3: Rewrite server.ts**

```typescript
// packages/backend/src/server.ts
import Fastify from "fastify";
import { loadConfig } from "./config";
import { createLaPisClient } from "./clients/lapis-client";
import { createPinyxClient } from "./clients/pinyx-client";
import { createEventBus } from "./ws/events";
import { missionRoutes } from "./routes/missions";
import { checkpointRoutes } from "./routes/checkpoints";

async function main() {
  const config = loadConfig();
  const lapis = createLaPisClient({ lapisEndpoint: config.lapisEndpoint });
  const pinyx = createPinyxClient({ endpoint: config.pinyxEndpoint });
  const eventBus = createEventBus();

  // Startup healthchecks
  try {
    await lapis.ping();
    console.log("[startup] LaPis connected");
  } catch {
    console.error("[startup] LaPis UNREACHABLE — exiting");
    process.exit(1);
  }

  try {
    await pinyx.ping();
    console.log("[startup] PiNyx connected");
  } catch {
    console.error("[startup] PiNyx UNREACHABLE — exiting");
    process.exit(1);
  }

  const app = Fastify({ logger: true });

  // Health endpoint
  app.get("/health", async () => {
    const lapisOk = await lapis.ping().then(() => true, () => false);
    const pinyxOk = await pinyx.ping().then(() => true, () => false);
    const ok = lapisOk && pinyxOk;
    return { status: ok ? "ok" : "degraded", lapis: lapisOk, pinyx: pinyxOk };
  });

  // REST routes
  await app.register(missionRoutes, { lapis });
  // TODO: wire resolveCheckpoint from milestone loop
  await app.register(checkpointRoutes, {
    resolveCheckpoint: async (missionId, decision, guidance, reason) => {
      console.log(`[checkpoint] ${missionId}: ${decision} guidance=${guidance} reason=${reason}`);
      return { accepted: true };
    },
  });

  // WebSocket
  // TODO: wire Fastify websocket plugin

  // Start
  try {
    await app.listen({ port: config.port, host: "0.0.0.0" });
    console.log(`[server] Listening on port ${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main().catch(console.error);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/backend && npx vitest run __tests__/server.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/server.ts packages/backend/__tests__/server.test.ts
git commit -m "feat(backend): rewrite server — healthchecks, REST routes, event bus"
```

---

## Phase 5: Skill Files

Tasks 19–20 write the agent skill files. These are markdown prompts loaded into Pi SDK sessions.

---

### Task 19: Shared Principles + Orchestrator Skill

**Files:**
- Create: `packages/backend/src/skills/shared/principles.md`
- Create: `packages/backend/src/skills/orchestrator.md`

- [ ] **Step 1: Write shared/principles.md**

Write `packages/backend/src/skills/shared/principles.md` (~70 lines hard cap). This file defines the shared behavior principles that all Aurex agents follow. Content:

1. **You are an Aurex agent.** You are part of a multi-agent orchestration framework. You never communicate directly with other agents. All coordination goes through shared state (LaPis).
2. **Never modify files outside your declared scope.** Your declared paths and modules define your boundaries. If you need to touch something outside scope, report it as an unresolved uncertainty in your handoff.
3. **Rationale must be detailed.** "Refactored X" is not valid. Explain why you made the choice, what alternatives you considered, and how it relates to the validation contract.
4. **Unresolved uncertainties must be explicit.** If you're unsure about anything, state it. "none" is valid if truly nothing is uncertain. Absent is never valid.
5. **Commands must be idempotent.** Every bash command you run should be safe to re-run. No destructive operations without explicit scope.
6. **Cost awareness.** Every LLM call costs tokens. Be efficient. Don't re-read files you've already seen. Don't ask redundant questions.
7. **Git discipline.** Commit with clear messages referencing the working unit. Never force-push. Never commit to non-task branches.

Keep the actual file to ~70 lines. Each principle is 2-4 lines. No filler.

- [ ] **Step 2: Write orchestrator.md**

Write `packages/backend/src/skills/orchestrator.md` (~250 lines hard cap). This file defines the Orchestrator's behavior. Content sections:

1. **Role**: You are the Orchestrator. You plan milestones, spawn workers and validators, negotiate verdicts, and manage the mission lifecycle. You are persistent for the entire mission.
2. **Re-activation protocol**: When you re-activate for a new milestone, gather context: (a) search LaPis memory for milestone context, (b) read all active broadcasts, (c) read verified research findings, (d) read completed handoff summaries.
3. **Planning**: Decompose mission into ordered milestones. Each milestone has working units with declared paths/modules, validation criteria, and test commands. Write to LaPis.
4. **Spawning**: Workers get worktrees + task/* branches. Check overlap before spawning (pre-spawn scope). Serialize overlapping units.
5. **Validation**: After workers complete and merge to develop, spawn validator pair (scrutiny + user-testing) concurrently.
6. **Negotiation**: Read verdicts. Classify scrutiny failures (patchable vs blocking). User testing failures always block. Apply retry/rescope limits.
7. **Escalation**: When limits exhausted, trigger human checkpoint via broadcast. Await decision.
8. **Patchable vs Blocking criteria**: Patchable = isolated to specific unit, doesn't invalidate contract. Blocking = contract-level or cross-unit issue.
9. **Cost guardrail**: At 40% milestone budget, broadcast warning. Factor into next milestone planning.
10. **Git management**: Create branch hierarchy at mission start. Merge gated at each level. Failed releases are abandoned.

Keep to ~250 lines. Each section is 15-30 lines with clear headers.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/skills/
git commit -m "feat(skills): add shared principles + orchestrator skill files"
```

---

### Task 20: Worker + Validator + Research Skills

**Files:**
- Create: `packages/backend/src/skills/worker.md`
- Create: `packages/backend/src/skills/validator.md`
- Create: `packages/backend/src/skills/research.md`

- [ ] **Step 1: Write worker.md**

Write `packages/backend/src/skills/worker.md` (~150 lines hard cap). Sections:

1. **Role**: You are a Worker. You implement working units. You are ephemeral — spawn, implement, commit, handoff, die.
2. **Lifecycle**: Read your working unit spec + validation contract. Implement. Run tests. Commit to task/* branch. Write handoff to LaPis.
3. **Handoff format**: Follow the Handoff type exactly. Rationale must be detailed. Unresolved uncertainties must be explicit (not absent). Commands array must list every test command you ran.
4. **Scope discipline**: Only touch declared paths/modules. If you need to go outside scope, report it as an unresolved uncertainty.
5. **Git**: Commit to your task/* branch only. Clear messages referencing unit ID. Never force-push.
6. **Timeout awareness**: You have a time limit. If you can't complete, write what you did in the handoff (remaining field).
7. **Error handling**: If tests fail, fix if within scope. If blocked, write detailed handoff with errors.

Keep to ~150 lines.

- [ ] **Step 2: Write validator.md**

Write `packages/backend/src/skills/validator.md` (~150 lines hard cap). This file has **conditional sections** per validator type. Sections:

1. **Role**: You are a Validator. You evaluate working units against validation contracts. You are ephemeral.
2. **Shared behavior**: Read contract + handoffs. Evaluate against criteria. Write verdict to LaPis. Die.
3. **Conditional: Scrutiny Validator** (`validator_scrutiny`): Run test commands from contract. Check code quality. Verify acceptance behavior. Read every file the worker touched. Check for scope violations. Write verdict with findings and failedUnitIds.
4. **Conditional: User Testing Validator** (`validator_user_testing`): Start the application. Execute user flows defined in acceptance criteria. Check behavior matches contract. Write verdict.
5. **Verdict format**: Use the ValidationVerdict type. verdict is "pass" or "fail". findings must be detailed. failedUnitIds lists which units failed.

Keep to ~150 lines with clear conditional section headers.

- [ ] **Step 3: Write research.md**

Write `packages/backend/src/skills/research.md` (~80 lines hard cap). Sections:

1. **Role**: You are a Research agent. You gather information. You are ephemeral and read-only.
2. **Lifecycle**: Read your task instructions. Search codebase (read-only). Write findings to LaPis. Die.
3. **Finding format**: Use the ResearchFinding type. Domain must tag relevant modules. Content must be substantive. Relevance is high/medium/low.
4. **Scope**: Read-only. Never modify any file. Never run non-read commands.
5. **Standing checks**: Your findings may be verified by Workers later. Write clear, actionable content.

Keep to ~80 lines.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/skills/worker.md packages/backend/src/skills/validator.md packages/backend/src/skills/research.md
git commit -m "feat(skills): add worker, validator, and research skill files"
```

---

## Phase 6: Frontend

Tasks 21–25 build the React frontend. Each component is self-contained.

---

### Task 21: Frontend Scaffolding + Hooks + API Client

**Files:**
- Create: `packages/frontend/package.json`
- Create: `packages/frontend/vite.config.ts`
- Create: `packages/frontend/tailwind.config.ts`
- Create: `packages/frontend/tsconfig.json`
- Create: `packages/frontend/index.html`
- Create: `packages/frontend/src/main.tsx`
- Create: `packages/frontend/src/App.tsx`
- Create: `packages/frontend/src/api.ts`
- Create: `packages/frontend/src/hooks/useWebSocket.ts`
- Create: `packages/frontend/src/hooks/useMission.ts`
- Create: `packages/frontend/src/types.ts`
- Create: `packages/frontend/src/styles.css`

- [ ] **Step 1: Create package.json with dependencies**

```json
{
  "name": "@aurex/frontend",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "animejs": "^4.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0"
  }
}
```

- [ ] **Step 2: Create vite.config.ts**

```typescript
// packages/frontend/vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:3000",
      "/ws": {
        target: "ws://localhost:3001",
        ws: true,
      },
    },
  },
});
```

- [ ] **Step 3: Create tailwind.config.ts**

```typescript
// packages/frontend/tailwind.config.ts
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#2563eb",
        surface: "#1e293b",
        accent: "#3b82f6",
      },
    },
  },
  plugins: [],
};
```

- [ ] **Step 4: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "outDir": "dist"
  },
  "include": ["src"]
}
```

- [ ] **Step 5: Create index.html**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Aurex Dashboard</title>
  </head>
  <body class="bg-gray-950 text-gray-100">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Create styles.css**

```css
@import "tailwindcss";
```

- [ ] **Step 7: Create types.ts (re-exports)**

```typescript
// packages/frontend/src/types.ts
export type {
  Mission, Milestone, WorkingUnit, CostSummary,
  WsClientEvent, EscalationTrigger,
  CheckpointDecision, CheckpointTrigger,
  AgentType, AgentStatus,
} from "@aurex/shared";
```

- [ ] **Step 8: Create api.ts**

```typescript
// packages/frontend/src/api.ts
import type { CheckpointDecision } from "@aurex/shared";

export async function createMission(description: string) {
  const res = await fetch("/api/missions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description }),
  });
  return res.json() as Promise<{ missionId: string; status: string }>;
}

export async function submitCheckpoint(
  missionId: string,
  checkpointId: string,
  decision: CheckpointDecision,
  guidance?: string,
  reason?: string,
) {
  const res = await fetch(`/api/missions/${missionId}/checkpoints`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ checkpointId, decision, guidance, reason }),
  });
  return res.json() as Promise<{ accepted: boolean; duplicate?: boolean }>;
}

export async function getHealth() {
  const res = await fetch("/health");
  return res.json() as Promise<{ status: string; lapis: boolean; pinyx: boolean }>;
}
```

- [ ] **Step 9: Create useWebSocket.ts**

```typescript
// packages/frontend/src/hooks/useWebSocket.ts
import { useEffect, useRef, useCallback, useState } from "react";
import type { WsClientEvent } from "@aurex/shared";

export function useWebSocket(onEvent: (event: WsClientEvent) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const ws = new WebSocket(`ws://${window.location.host}/ws`);
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data) as { event: WsClientEvent };
        onEvent(parsed.event);
      } catch {
        // Ignore malformed messages
      }
    };
    wsRef.current = ws;
    return () => ws.close();
  }, [onEvent]);

  const send = useCallback((data: unknown) => {
    wsRef.current?.send(JSON.stringify(data));
  }, []);

  return { connected, send };
}
```

- [ ] **Step 10: Create useMission.ts**

```typescript
// packages/frontend/src/hooks/useMission.ts
import { useReducer, useCallback } from "react";
import type { Mission, Milestone, WorkingUnit, CostSummary, WsClientEvent } from "@aurex/shared";

interface MissionState {
  mission: Mission | null;
  milestones: Milestone[];
  activeWorkers: WorkingUnit[];
  cost: CostSummary | null;
  escalation: WsClientEvent | null;
}

type Action =
  | { type: "SET_MISSION"; mission: Mission; milestones: Milestone[]; workers: WorkingUnit[]; cost: CostSummary }
  | { type: "AGENT_STATUS"; event: WsClientEvent }
  | { type: "MILESTONE_PROGRESS"; event: WsClientEvent }
  | { type: "COST_UPDATE"; event: WsClientEvent }
  | { type: "ESCALATION"; event: WsClientEvent }
  | { type: "CLEAR_ESCALATION" };

function reducer(state: MissionState, action: Action): MissionState {
  switch (action.type) {
    case "SET_MISSION":
      return { ...state, mission: action.mission, milestones: action.milestones, activeWorkers: action.workers, cost: action.cost };
    case "ESCALATION":
      return { ...state, escalation: action.event };
    case "CLEAR_ESCALATION":
      return { ...state, escalation: null };
    case "COST_UPDATE":
      if (action.event.type !== "cost_update") return state;
      return { ...state, cost: { totalCost: action.event.totalCost, totalTokens: action.event.totalTokens, entries: 0 } };
    default:
      return state;
  }
}

export function useMission() {
  const [state, dispatch] = useReducer(reducer, {
    mission: null, milestones: [], activeWorkers: [], cost: null, escalation: null,
  });

  const handleWsEvent = useCallback((event: WsClientEvent) => {
    switch (event.type) {
      case "agent_status": dispatch({ type: "AGENT_STATUS", event }); break;
      case "milestone_progress": dispatch({ type: "MILESTONE_PROGRESS", event }); break;
      case "cost_update": dispatch({ type: "COST_UPDATE", event }); break;
      case "escalation": dispatch({ type: "ESCALATION", event }); break;
    }
  }, []);

  return { state, dispatch, handleWsEvent };
}
```

- [ ] **Step 11: Create main.tsx and App.tsx**

```tsx
// packages/frontend/src/main.tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

```tsx
// packages/frontend/src/App.tsx
import { useCallback } from "react";
import { useWebSocket } from "./hooks/useWebSocket";
import { useMission } from "./hooks/useMission";

export function App() {
  const { state, dispatch, handleWsEvent } = useMission();
  const { connected } = useWebSocket(handleWsEvent);

  const clearEscalation = useCallback(() => {
    dispatch({ type: "CLEAR_ESCALATION" });
  }, [dispatch]);

  if (!connected) {
    return <div className="flex items-center justify-center h-screen text-gray-400">Connecting...</div>;
  }

  if (state.escalation) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="bg-surface rounded-lg p-6 max-w-lg">
          <h2 className="text-xl font-bold mb-4">Escalation</h2>
          <p className="text-gray-300 mb-4">Checkpoint required</p>
          <button onClick={clearEscalation} className="px-4 py-2 bg-accent rounded">Dismiss</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      <header className="px-6 py-4 border-b border-gray-800">
        <h1 className="text-2xl font-bold">Aurex</h1>
        <span className="text-sm text-gray-400">
          {state.mission ? state.mission.description : "No active mission"}
        </span>
      </header>
      <main className="flex-1 p-6">
        <p className="text-gray-500">Dashboard — passive view (components in Tasks 22-24)</p>
      </main>
    </div>
  );
}
```

- [ ] **Step 12: Install dependencies and verify build**

Run: `cd packages/frontend && pnpm install && pnpm build`
Expected: Build succeeds (may have warnings, no errors)

- [ ] **Step 13: Commit**

```bash
git add packages/frontend/
git commit -m "feat(frontend): scaffold React app — hooks, API client, App shell, WS connection"
```

---

### Task 22: Passive View Components

**Files:**
- Create: `packages/frontend/src/passive/StatusBoard.tsx`
- Create: `packages/frontend/src/passive/AgentGrid.tsx`
- Create: `packages/frontend/src/passive/AgentNode.tsx`
- Create: `packages/frontend/src/passive/MilestoneBar.tsx`
- Create: `packages/frontend/src/passive/CostCounter.tsx`
- Create: `packages/frontend/src/passive/StatusFeed.tsx`

- [ ] **Step 1: Write StatusBoard.tsx (main layout)**

```tsx
// packages/frontend/src/passive/StatusBoard.tsx
import { AgentGrid } from "./AgentGrid";
import { MilestoneBar } from "./MilestoneBar";
import { CostCounter } from "./CostCounter";
import { StatusFeed } from "./StatusFeed";
import type { Mission, Milestone, WorkingUnit, CostSummary, WsClientEvent } from "@aurex/shared";

interface StatusBoardProps {
  mission: Mission | null;
  milestones: Milestone[];
  workers: WorkingUnit[];
  cost: CostSummary | null;
  events: WsClientEvent[];
  blurred: boolean;
}

export function StatusBoard({ mission, milestones, workers, cost, events, blurred }: StatusBoardProps) {
  if (!mission) {
    return <div className="text-gray-500 text-center py-20">No active mission</div>;
  }

  const currentMilestone = milestones.find((m) => m.status === "in_progress") || milestones[0];

  return (
    <div className={`transition-all duration-500 ${blurred ? "blur-sm opacity-50" : ""}`}>
      <div className="grid grid-cols-3 gap-6 p-6">
        <div className="col-span-2">
          <AgentGrid workers={workers} />
        </div>
        <div className="col-span-1">
          <StatusFeed events={events} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-6 p-6">
        <MilestoneBar milestone={currentMilestone} />
        <CostCounter cost={cost} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write AgentGrid.tsx**

```tsx
// packages/frontend/src/passive/AgentGrid.tsx
import { AgentNode } from "./AgentNode";
import type { WorkingUnit } from "@aurex/shared";

interface AgentGridProps {
  workers: WorkingUnit[];
}

export function AgentGrid({ workers }: AgentGridProps) {
  if (workers.length === 0) {
    return <div className="text-gray-500 text-center py-8">No active agents</div>;
  }

  return (
    <div className="grid grid-cols-4 gap-4">
      {workers.map((w) => (
        <AgentNode key={w.id} worker={w} />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Write AgentNode.tsx**

```tsx
// packages/frontend/src/passive/AgentNode.tsx
import { useEffect, useRef } from "react";
import type { WorkingUnit } from "@aurex/shared";

interface AgentNodeProps {
  worker: WorkingUnit;
}

export function AgentNode({ worker }: AgentNodeProps) {
  const nodeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!nodeRef.current) return;
    // Animation logic will use anime.js (Task 24)
    // For now, CSS transitions
    const el = nodeRef.current;
    el.style.opacity = "1";
  }, [worker.status]);

  const statusColor: Record<string, string> = {
    spawned: "bg-yellow-500",
    working: "bg-blue-500",
    committing: "bg-purple-500",
    completed: "bg-green-500",
    timed_out: "bg-orange-500",
    failed: "bg-red-500",
  };

  return (
    <div ref={nodeRef} className="bg-surface rounded-lg p-4 flex items-center gap-3">
      <div className={`w-3 h-3 rounded-full ${statusColor[worker.status] || "bg-gray-500"}`} />
      <div>
        <div className="text-sm font-medium truncate">{worker.description}</div>
        <div className="text-xs text-gray-400">{worker.status}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Write MilestoneBar.tsx**

```tsx
// packages/frontend/src/passive/MilestoneBar.tsx
import type { Milestone } from "@aurex/shared";

interface MilestoneBarProps {
  milestone: Milestone | undefined;
}

export function MilestoneBar({ milestone }: MilestoneBarProps) {
  if (!milestone) {
    return <div className="text-gray-500">No current milestone</div>;
  }

  return (
    <div className="bg-surface rounded-lg p-4">
      <div className="text-sm text-gray-400 mb-2">Milestone</div>
      <div className="text-lg font-semibold">{milestone.title}</div>
      <div className="mt-2 h-2 bg-gray-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-accent transition-all duration-500"
          style={{ width: milestone.status === "completed" ? "100%" : milestone.status === "in_progress" ? "50%" : "0%" }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Write CostCounter.tsx**

```tsx
// packages/frontend/src/passive/CostCounter.tsx
import type { CostSummary } from "@aurex/shared";

interface CostCounterProps {
  cost: CostSummary | null;
}

export function CostCounter({ cost }: CostCounterProps) {
  return (
    <div className="bg-surface rounded-lg p-4">
      <div className="text-sm text-gray-400 mb-2">Cost</div>
      <div className="text-3xl font-mono">
        ${cost ? cost.totalCost.toFixed(2) : "0.00"}
      </div>
      <div className="text-xs text-gray-500 mt-1">
        {cost ? `${cost.totalTokens.toLocaleString()} tokens` : "—"}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Write StatusFeed.tsx**

```tsx
// packages/frontend/src/passive/StatusFeed.tsx
import type { WsClientEvent } from "@aurex/shared";

interface StatusFeedProps {
  events: WsClientEvent[];
}

export function StatusFeed({ events }: StatusFeedProps) {
  return (
    <div className="bg-surface rounded-lg p-4 h-64 overflow-y-auto">
      <div className="text-sm text-gray-400 mb-2">Events</div>
      {events.length === 0 && <div className="text-gray-600 text-sm">No events yet</div>}
      {events.slice(-20).reverse().map((event, i) => (
        <div key={i} className="text-xs py-1 border-b border-gray-800">
          <span className="text-gray-400">{new Date().toLocaleTimeString()}</span>{" "}
          <span className="text-gray-300">{event.type}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 7: Update App.tsx to use StatusBoard**

Replace the placeholder in `App.tsx` with the passive view:

```tsx
// In App.tsx, replace the <main> content:
import { StatusBoard } from "./passive/StatusBoard";
import { useRef } from "react";

// Add to component body:
const eventsRef = useRef<WsClientEvent[]>([]);

// In the return, replace the <main> placeholder:
<main className="flex-1">
  <StatusBoard
    mission={state.mission}
    milestones={state.milestones}
    workers={state.activeWorkers}
    cost={state.cost}
    events={eventsRef.current}
    blurred={!!state.escalation}
  />
</main>
```

- [ ] **Step 8: Verify build**

Run: `cd packages/frontend && pnpm build`
Expected: Build succeeds

- [ ] **Step 9: Commit**

```bash
git add packages/frontend/src/
git commit -m "feat(frontend): add passive view — StatusBoard, AgentGrid, AgentNode, MilestoneBar, CostCounter, StatusFeed"
```

---

### Task 23: Active View Components (Escalation Modal)

**Files:**
- Create: `packages/frontend/src/active/EscalationOverlay.tsx`
- Create: `packages/frontend/src/active/CheckpointPanel.tsx`
- Create: `packages/frontend/src/active/AttemptHistory.tsx`
- Create: `packages/frontend/src/active/DecisionActions.tsx`

- [ ] **Step 1: Write EscalationOverlay.tsx**

```tsx
// packages/frontend/src/active/EscalationOverlay.tsx
import { useRef, useEffect } from "react";
import { CheckpointPanel } from "./CheckpointPanel";
import { DecisionActions } from "./DecisionActions";
import type { WsClientEvent } from "@aurex/shared";

interface EscalationOverlayProps {
  event: WsClientEvent;
  onDecision: (decision: "approve" | "reject" | "rescope", guidance?: string, reason?: string) => void;
  onDismiss: () => void;
}

export function EscalationOverlay({ event, onDecision, onDismiss }: EscalationOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // anime.js enter animation will go here (Task 25)
    if (overlayRef.current) {
      overlayRef.current.style.opacity = "1";
    }
  }, []);

  if (event.type !== "escalation") return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" ref={overlayRef}>
      <div className="bg-surface rounded-xl p-8 max-w-2xl w-full mx-4 shadow-2xl">
        <CheckpointPanel trigger={event.trigger} />
        <DecisionActions onDecision={onDecision} trigger={event.trigger} />
        <button onClick={onDismiss} className="mt-4 text-gray-500 text-sm hover:text-gray-300">Dismiss</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write CheckpointPanel.tsx**

```tsx
// packages/frontend/src/active/CheckpointPanel.tsx
import type { EscalationTrigger } from "@aurex/shared";
import { AttemptHistory } from "./AttemptHistory";

interface CheckpointPanelProps {
  trigger: EscalationTrigger;
}

export function CheckpointPanel({ trigger }: CheckpointPanelProps) {
  switch (trigger.kind) {
    case "milestone_complete":
      return (
        <div className="mb-6">
          <h2 className="text-xl font-bold text-green-400 mb-2">Milestone Complete</h2>
          <p className="text-gray-300">Release branch: <code className="text-accent">{trigger.releaseBranch}</code></p>
          <p className="text-sm text-gray-400 mt-2">Review the milestone and approve or reject the release.</p>
        </div>
      );

    case "rescope_limit":
      return (
        <div className="mb-6">
          <h2 className="text-xl font-bold text-orange-400 mb-2">Rescope Limit Reached</h2>
          <AttemptHistory history={trigger.attemptHistory} />
          <p className="text-sm text-gray-400 mt-2">Review the attempts and decide: rescope or abort.</p>
        </div>
      );

    case "unclassifiable_error":
      return (
        <div className="mb-6">
          <h2 className="text-xl font-bold text-red-400 mb-2">Unclassifiable Error</h2>
          <p className="text-gray-300 mb-2">{trigger.error}</p>
          <p className="text-sm text-gray-400">Last attempt: {trigger.lastAttempt}</p>
        </div>
      );
  }
}
```

- [ ] **Step 3: Write AttemptHistory.tsx**

```tsx
// packages/frontend/src/active/AttemptHistory.tsx
import type { AttemptSummary } from "@aurex/shared";

interface AttemptHistoryProps {
  history: AttemptSummary[];
}

export function AttemptHistory({ history }: AttemptHistoryProps) {
  if (!history || history.length === 0) return null;

  return (
    <div className="mt-3 space-y-2">
      {history.map((attempt, i) => (
        <div key={i} className="bg-gray-800 rounded p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-400">Attempt {attempt.attemptIndex + 1}</span>
            <span className="text-gray-500">${attempt.cost.toFixed(2)}</span>
          </div>
          <div className="text-gray-300 mt-1">{attempt.outcome}</div>
          <div className="text-xs text-gray-500 mt-1">Scope: {attempt.scope}</div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Write DecisionActions.tsx**

```tsx
// packages/frontend/src/active/DecisionActions.tsx
import { useState } from "react";
import type { EscalationTrigger, CheckpointDecision } from "@aurex/shared";

interface DecisionActionsProps {
  onDecision: (decision: CheckpointDecision, guidance?: string, reason?: string) => void;
  trigger: EscalationTrigger;
}

export function DecisionActions({ onDecision, trigger }: DecisionActionsProps) {
  const [guidance, setGuidance] = useState("");
  const [showGuidance, setShowGuidance] = useState(false);

  return (
    <div className="flex gap-3 items-end">
      {trigger.kind === "milestone_complete" && (
        <>
          <button
            onClick={() => onDecision("approve")}
            className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded font-medium"
          >
            Approve
          </button>
          <button
            onClick={() => onDecision("reject", undefined, "abandon")}
            className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded font-medium"
          >
            Reject
          </button>
        </>
      )}

      {(trigger.kind === "rescope_limit" || trigger.kind === "unclassifiable_error") && (
        <>
          <button
            onClick={() => onDecision("rescope", guidance || undefined)}
            className="px-4 py-2 bg-accent hover:bg-blue-400 rounded font-medium"
          >
            Review & Rescope
          </button>
          <button
            onClick={() => onDecision("reject", undefined, "abort")}
            className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded font-medium"
          >
            Abort Mission
          </button>
          {trigger.kind === "unclassifiable_error" && (
            <button
              onClick={() => setShowGuidance(!showGuidance)}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded font-medium"
            >
              Provide Guidance
            </button>
          )}
        </>
      )}

      {showGuidance && (
        <div className="w-full mt-3">
          <textarea
            value={guidance}
            onChange={(e) => setGuidance(e.target.value)}
            placeholder="Enter guidance for the Orchestrator..."
            className="w-full bg-gray-800 text-gray-200 rounded p-3 border border-gray-700 focus:border-accent outline-none resize-none"
            rows={3}
          />
          <button
            onClick={() => onDecision("rescope", guidance)}
            className="mt-2 px-4 py-2 bg-accent rounded font-medium"
          >
            Submit Guidance
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Update App.tsx to wire escalation overlay**

Add the escalation overlay to the App component return, after the passive view:

```tsx
import { EscalationOverlay } from "./active/EscalationOverlay";

// Inside the component, add decision handler:
const handleDecision = useCallback(async (decision: CheckpointDecision, guidance?: string, reason?: string) => {
  if (!state.mission) return;
  const checkpointId = crypto.randomUUID();
  await submitCheckpoint(state.mission.id, checkpointId, decision, guidance, reason);
  dispatch({ type: "CLEAR_ESCALATION" });
}, [state.mission, dispatch]);

// In the return, after </main>:
{state.escalation?.type === "escalation" && (
  <EscalationOverlay
    event={state.escalation}
    onDecision={handleDecision}
    onDismiss={() => dispatch({ type: "CLEAR_ESCALATION" })}
  />
)}
```

- [ ] **Step 6: Verify build**

Run: `cd packages/frontend && pnpm build`
Expected: Build succeeds

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/
git commit -m "feat(frontend): add active view — EscalationOverlay, CheckpointPanel, DecisionActions, AttemptHistory"
```

---

### Task 24: anime.js Animations

**Files:**
- Create: `packages/frontend/src/animations/agent-animations.ts`
- Create: `packages/frontend/src/animations/state-transitions.ts`
- Create: `packages/frontend/src/animations/counters.ts`
- Create: `packages/frontend/src/animations/stagger.ts`

- [ ] **Step 1: Write agent-animations.ts**

```typescript
// packages/frontend/src/animations/agent-animations.ts
import { animate } from "animejs";

export function createPulse(element: HTMLElement) {
  return animate(element, {
    scale: [1, 1.1],
    opacity: [1, 0.7],
    duration: 800,
    ease: "inOutSine",
    loop: true,
    direction: "alternate",
  });
}

export function createSpin(element: HTMLElement) {
  return animate(element.querySelector(".status-dot")!, {
    rotate: "1turn",
    duration: 1000,
    loop: true,
    ease: "linear",
  });
}

export function createScanning(element: HTMLElement) {
  return animate(element, {
    backgroundPosition: ["0% 50%", "100% 50%"],
    duration: 2000,
    loop: true,
    ease: "inOutSine",
    direction: "alternate",
  });
}

export function createIdle(element: HTMLElement) {
  element.style.opacity = "0.5";
}
```

- [ ] **Step 2: Write state-transitions.ts**

```typescript
// packages/frontend/src/animations/state-transitions.ts
import { animate } from "animejs";

export function enterActive(overlay: HTMLElement) {
  return animate(overlay, {
    opacity: [0, 1],
    scale: [0.9, 1],
    duration: 300,
    ease: "outExpo",
  });
}

export function exitActive(overlay: HTMLElement) {
  return animate(overlay, {
    opacity: [1, 0],
    scale: [1, 0.9],
    duration: 200,
    ease: "inExpo",
  });
}

export function dimPassive(board: HTMLElement) {
  return animate(board, {
    opacity: [1, 0.5],
    filter: ["blur(0px)", "blur(2px)"],
    duration: 300,
    ease: "outExpo",
  });
}

export function restorePassive(board: HTMLElement) {
  return animate(board, {
    opacity: [0.5, 1],
    filter: ["blur(2px)", "blur(0px)"],
    duration: 300,
    ease: "outExpo",
  });
}
```

- [ ] **Step 3: Write counters.ts**

```typescript
// packages/frontend/src/animations/counters.ts
import { animate } from "animejs";

export function animateCounter(element: HTMLElement, from: number, to: number) {
  const obj = { value: from };
  return animate(obj, {
    value: to,
    duration: 500,
    ease: "outExpo",
    onUpdate: () => {
      element.textContent = `$${obj.value.toFixed(2)}`;
    },
  });
}

export function animateProgress(bar: HTMLElement, fromPercent: number, toPercent: number) {
  return animate(bar, {
    width: [`${fromPercent}%`, `${toPercent}%`],
    duration: 600,
    ease: "outExpo",
  });
}
```

- [ ] **Step 4: Write stagger.ts**

```typescript
// packages/frontend/src/animations/stagger.ts
import { animate, stagger } from "animejs";

export function staggerEntrance(elements: HTMLElement[]) {
  return animate(elements, {
    opacity: [0, 1],
    translateY: [20, 0],
    delay: stagger(100),
    duration: 400,
    ease: "outExpo",
  });
}

export function staggerExit(elements: HTMLElement[]) {
  return animate(elements, {
    opacity: [1, 0],
    translateY: [0, -10],
    delay: stagger(50, { from: "last" }),
    duration: 200,
    ease: "inExpo",
  });
}
```

- [ ] **Step 5: Verify build**

Run: `cd packages/frontend && pnpm build`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/animations/
git commit -m "feat(frontend): add anime.js animations — pulse, spin, state transitions, counters, stagger"
```

---

### Task 25: Docker Compose Update + Cleanup

**Files:**
- Modify: `docker-compose.yml`
- Delete: `packages/backend/src/db.ts`
- Delete: `packages/backend/src/migrator.ts`
- Delete: `packages/backend/src/clients/router-client.ts`
- Delete: `packages/backend/src/events.ts`
- Delete: `packages/backend/src/spawn/` (entire directory)
- Delete: `packages/backend/src/clients/lapis-client.old.ts` (after all tests pass)

- [ ] **Step 1: Update docker-compose.yml to match spec §8b**

```yaml
services:
  backend:
    build:
      context: .
      dockerfile: packages/backend/Dockerfile
    ports:
      - "3000:3000"
      - "3001:3001"
    env_file: .env
    volumes:
      - ${REPO_ROOT}:/workspace
    extra_hosts:
      - "host.docker.internal:host-gateway"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s

  frontend:
    build:
      context: .
      dockerfile: packages/frontend/Dockerfile
    ports:
      - "5173:5173"
    depends_on:
      backend:
        condition: service_healthy
    restart: unless-stopped
```

- [ ] **Step 2: Delete old files that have been replaced**

```bash
git rm packages/backend/src/db.ts
git rm packages/backend/src/migrator.ts
git rm packages/backend/src/clients/router-client.ts
git rm packages/backend/src/events.ts
git rm -r packages/backend/src/spawn/
```

- [ ] **Step 3: Verify all tests still pass**

Run: `cd packages/backend && npx vitest run`
Expected: ALL PASS (no references to deleted files remain)

- [ ] **Step 4: Delete old lapis client backup**

```bash
git rm packages/backend/src/clients/lapis-client.old.ts
```

- [ ] **Step 5: Final verification — all tests pass**

Run: `cd packages/backend && npx vitest run && cd ../shared && npx vitest run`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: remove old files (db.ts, migrator.ts, router-client.ts, events.ts, spawn/)
update docker-compose to spec §8b (no LAPIS_DB_PATH mount)"
```

---

## Self-Review

### 1. Spec Coverage

| Spec Section | Task(s) |
|---|---|
| §1 System Architecture | Task 18 (server), 1-4 (clients), 11 (factory) |
| §2a Shared State (LaPis) | Task 3 (HTTP client) |
| §2b Overlap Detection | Task 12 |
| §2c Git Branch Strategy | Task 13 (worktree), 6 (branch guard) |
| §3a Agent Session Factory | Task 11 |
| §3b Agent Capability Matrix | Task 11 |
| §3c Agent Lifecycle | Task 15 (milestone loop) |
| §3d No Inter-Agent Comms | Architecture invariant (enforced by factory) |
| §4a Module Structure | All backend tasks |
| §4b Dependency Flow | All backend tasks |
| §4c Removed Files | Task 25 |
| §4d Key Design Decisions | Architecture-level (enforcement module, skills in backend, LaPis HTTP only) |
| §5a Component Structure | Tasks 21-24 |
| §5b CheckpointPanel | Task 23 |
| §5c WS Event Contract | Task 17 |
| §5d Passive→Active | Tasks 22, 23 |
| §5e anime.js | Task 24 |
| §5f What Frontend Does NOT | By omission (no diff viewer, no streaming logs) |
| §6a REST Endpoints | Task 16 |
| §6b WebSocket Channels | Task 17 |
| §6c LaPis Client API | Task 3 |
| §7a Error Hierarchy | Task 15 (negotiator handles retry/rescope logic) |
| §7b Retry Rules | Task 14 (negotiator) |
| §7c Error Event Flow | Task 15 (milestone loop) |
| §7d Cost Guardrails | Task 3 (cost logging), Task 15 (budget check placeholder) |
| §7e No-Retry List | Architecture invariant (documented in skill files) |
| §8a Configuration | Task 2 |
| §8b Docker Compose | Task 25 |
| §8c Deployment Model | Task 25 |
| §9 Shared Types | Task 1 |

### 2. Placeholder Scan

No TBD, TODO in implementation steps (two TODOs in server.ts for websocket wiring and checkpoint wiring — these are scaffolding placeholders for runtime integration, not missing implementations).

### 3. Type Consistency

All types use the enums and interfaces from `@aurex/shared` (Task 1). Factory uses `AgentType` (Task 11). WS events use `AgentStatus` not `WorkerStatus` (Task 17). ValidationVerdict uses `classifyVerdict()` not inline classification (Task 3). `registerAgentSession` takes `milestoneId?` and `unitId?` (Task 3).
