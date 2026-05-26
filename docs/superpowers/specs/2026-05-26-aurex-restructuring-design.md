# Aurex Restructuring Design

Date: 2026-05-26
Status: Approved
Spec: Missions Framework v5 (source of truth)

## 1. System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        AUREX RUNTIME                            │
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │ Orchestrator  │    │  PiNyx       │    │   LaPis      │      │
│  │ (persistent)  │    │  Gateway     │    │   (shared    │      │
│  │              │    │  :7331       │    │    state DB)  │      │
│  └──────┬───────┘    └──────▲───────┘    └──────▲───────┘      │
│         │                   │                   │              │
│         │ spawns            │ all LLM calls     │ all data     │
│         │                   │                   │ access       │
│         ▼                   │                   │              │
│  ┌──────────────┐  ┌───────┴──────┐  ┌─────────┴──────┐      │
│  │   Workers    │  │  Validators  │  │   Research     │      │
│  │  (ephemeral) │  │   (paired)   │  │  (read-only)   │      │
│  │              │  │              │  │                │      │
│  │ Pi SDK       │  │ Pi SDK       │  │ Pi SDK         │      │
│  │ + worktree   │  │ + restricted │  │ + read-only    │      │
│  │ + task/*     │  │              │  │                │      │
│  └──────────────┘  └──────────────┘  └────────────────┘      │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Fastify Server                        │   │
│  │  REST API (missions, checkpoints)  │  WebSocket (events) │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    FRONTEND (React + Vite)                       │
│                                                                 │
│  ┌─────────────────┐  ┌──────────────────────────────────────┐ │
│  │  Passive View   │  │  Active View (escalation modal)      │ │
│  │  • Agent grid   │  │  • Checkpoint context                │ │
│  │  • Milestone    │  │  • Approve / Reject / Re-scope       │ │
│  │  • Cost counter │  │  • Attempt history                   │ │
│  │  • Status feed  │  │                                      │ │
│  └─────────────────┘  └──────────────────────────────────────┘ │
│                                                                 │
│  Tailwind CSS + anime.js v4 (all animations)                    │
└─────────────────────────────────────────────────────────────────┘
```

### Architectural Invariants

1. **LaPis IS the shared state DB** — all data access through LaPis client, never direct SQLite
2. **No direct agent communication** — isolated Pi SDK sessions + restricted tool sets
3. **PiNyx is the sole LLM gateway** — all model calls route through `localhost:7331`
4. **Each Worker gets its own git worktree** — filesystem isolation by default
5. **Logic in skill files, boundaries in runtime** — ~700 lines across agent skills + shared principles

---

## 2. Data Layer & Git Infrastructure

### 2a. Shared State (LaPis)

LaPis owns a single SQLite database. The backend connects via HTTP (`LAPIS_ENDPOINT`), never opens SQLite directly.

**Core tables:**

| Table | Purpose | Key Constraints |
|---|---|---|
| `missions` | Mission definitions, status, config | Status: planning → running → paused → completed/failed |
| `milestones` | Ordered execution units within a mission | Linked to current (non-superseded) validation contract |
| `working_units` | Individual work assignments | Declared scope (paths + modules) set by Orchestrator at spawn |
| `handoffs` | Worker exit reports | Structural validation at runtime (§7c) |
| `validation_contracts` | Immutable acceptance criteria | Append-only with versioning |
| `validation_verdicts` | Validator evaluation results | Linked to contract + validator session, read by Negotiator |
| `broadcasts` | Agent status, constraints, new context | Lifecycle enforced with actor authorization |
| `research_findings` | Research subagent outputs | Epistemic lifecycle with standing checks |
| `agent_sessions` | Spawning records with session IDs | Enables Creator-Verifier audit |
| `retry_counters` | Per-milestone retry tracking | 2 max validator retries, 5 max re-scopes |
| `rescope_history` | Full re-scope event log | Mandatory when superseding contracts |
| `cost_entries` | Token and cost tracking per call | Aggregated for mission-level cost |
| `state_compression_artifacts` | Reserved — deferred per spec §12 | Structure defined when compression subsystem built |

**LaPis enforces at the write layer:**
- Broadcast lifecycle transitions + actor authorization
- Research finding transitions + standing checks
- Validation contract append-only semantics
- Transaction + locking for concurrent agent writes
- Broadcast TTL auto-expiry at compression checkpoints

### 2b. Overlap Detection — Pre-spawn vs Post-commit

Two distinct phases of scope evaluation:

- **Pre-spawn scope** (at spawn decision): `declared_paths ∪ declared_modules` only. Git diff doesn't exist yet — the task branch hasn't been written to. This determines concurrent vs serialized execution.
- **Post-commit scope** (before merging to develop): `declared_paths ∪ declared_modules ∪ git_diff_files(task_branch, develop)`. Catches declaration drift.

The runtime re-checks overlap at merge time using post-commit scope. If a Worker's actual scope overlaps with a concurrently-running Worker's scope (discovered post-commit), the merge to `develop` is blocked until the other Worker completes and a merge conflict check passes.

Declaration drift (declared vs actual scope divergence) is logged to shared state. Repeated drift signals spec decomposition needs tightening.

### 2c. Git Branch Strategy & Merge Flow

```
main
└── release/milestone-1
    └── develop
        └── agent/worker-a/auth-feature
            └── task/worker-a/auth-feature-001
        └── agent/worker-b/api-routes
            └── task/worker-b/api-routes-001

Merge flow (gated at each level):
task/* ──(commit validation)──▶ agent/*
agent/* ──(integration check)──▶ develop
develop ──(validator pair passes)──▶ release/milestone-x
release/milestone-x ──(human approval)──▶ main
```

**Runtime enforcement:**
- Orchestrator creates full hierarchy at mission start
- Workers spawned into worktrees with `task/*` pre-checked out
- Git hooks in each worktree reject commits to non-`task/*` branches
- Failed release branches are abandoned, not force-pushed. Main stays clean.

---

## 3. Agent Architecture

### 3a. Agent Session Factory

Each agent type maps to a Pi SDK session configuration. The factory creates isolated sessions with the correct tools, skills, and constraints.

```typescript
interface AgentConfig {
  type: AgentType; // "orchestrator" | "worker" | "validator_scrutiny" | "validator_user_testing" | "research"
  sessionId: string;
  spec: AgentSpec;
  lapisClient: LaPisClient;
  pinyxEndpoint: string;
  missionId: string;
}

async function createAurexAgent(config: AgentConfig): Promise<AgentSession> {
  const tools = AGENT_TOOLS[config.type];
  const skillFile = AGENT_SKILL[config.type];
  const cwd = resolveWorktreePath(config);

  return createPiSession({
    cwd,
    tools,
    model: resolveModel(config.type),
    sessionManager: SessionManager.inMemory(cwd),
    resourceLoader: new DefaultResourceLoader({
      skillsOverride: (current) => ({
        skills: [
          ...current.skills,
          { name: "shared-principles", filePath: "skills/shared/principles.md", ... },
          { name: `aurex-${config.type}`, filePath: skillFile, ... },
        ],
        diagnostics: current.diagnostics,
      }),
      additionalExtensionPaths: needsMemoryLayer(config.type)
        ? ["~/.pi/agent/git/github.com/GeneGulanesJr/LaPis/skills/memory-layer/SKILL.md"]
        : [],
    }),
  });
}
```

### 3b. Agent Capability Matrix

| Agent | Pi SDK Tools | Skill File | LaPis Access | Git Scope | Persistence |
|---|---|---|---|---|---|
| **Orchestrator** | `read` | `orchestrator.md` | Direct client: full read + planning writes | Creates branch hierarchy, handles all merges upward | Persistent (one per mission) |
| **Worker** | `read`, `write`, `edit`, `bash` | `worker.md` | Memory-layer extension + handoff writes | `task/*` only (worktree) | Ephemeral (spawn → commit → die) |
| **Validator (scrutiny)** | `read`, `bash` (tests only) | `validator.md` | Read contracts + handoffs, write verdicts | None | Ephemeral |
| **Validator (user-testing)** | `read`, `bash` (run app) | `validator.md` | Read contracts + handoffs, write verdicts | None | Ephemeral |
| **Research** | `read` | `research.md` | Memory-layer extension + finding writes | None | Ephemeral |

**Memory-layer extension** loaded for Workers and Research only. Orchestrator uses a direct LaPis client for planning queries and shared state writes. Validators access LaPis through the backend, not an extension.

**Orchestrator memory re-injection**: the Orchestrator re-injects context each time it re-activates for a new milestone. This is a richer, targeted query — not the 3-memory injection Workers get at spawn:

```
Orchestrator re-activates for milestone N:
  1. LaPis searchMemory("milestone N context, outcomes of milestone N-1")
  2. Read all active broadcasts
  3. Read all verified research findings for this mission
  4. Read completed milestone handoff summaries
  5. Build planning context from union of above
```

The skill prompt (`orchestrator.md`) specifies the re-activation context-gathering protocol. The direct LaPis client (`searchMemory`) is the mechanism.

### 3c. Agent Lifecycle

```
Mission Created
    │
    ▼
Orchestrator activated (persistent for mission lifetime)
    │
    ├── Plans milestones, writes validation contracts
    ├── Spawns Workers (concurrent where non-overlapping)
    │   └── Each Worker: create worktree → Pi SDK session → implement → commit → handoff → die
    │
    ├── After all Workers complete + merge to develop
    │   └── Spawns Validator pair (scrutiny + user-testing) concurrently
    │       └── Each Validator: Pi SDK session → evaluate against contract → verdict → die
    │
    ├── Negotiation: reads verdicts, decides pass/retry/rescope
    │   ├── Pass → cut release → human checkpoint
    │   ├── Retry (≤2) → re-spawn failed units
    │   └── Rescope (≤5) → decompose, new contract, re-run
    │
    └── Human checkpoint triggered → dashboard escalates → await decision
```

### 3d. Inter-Agent Communication — NONE

Agents never communicate directly. All coordination through shared state:

- **Workers** → write handoffs to shared state
- **Validators** → read handoffs + contracts, write verdicts
- **Research** → write findings to shared state
- **Orchestrator** → reads all shared state, writes plans/contracts/broadcasts, negotiates
- **LaPis** → the only write surface, enforcing lifecycle rules at the write layer

No inter-process communication, no shared memory, no message passing.

---

## 4. Backend Architecture

### 4a. Module Structure

```
packages/backend/src/
├── server.ts                    # Fastify entry, WebSocket, startup healthchecks
├── config.ts                    # AppConfig from env vars
│
├── clients/
│   ├── lapis-client.ts          # LaPis shared state client (HTTP). New implementation.
│   │                           # Migration: old CLI-subprocess version renamed to
│   │                           # lapis-client.old.ts during transition, deleted after tests pass.
│   └── pinyx-client.ts          # PiNyx LLM gateway client. Replaces old router-client.ts
│
├── agents/
│   ├── factory.ts               # createAgentSession per type
│   ├── orchestrator-session.ts  # Persistent orchestrator session management
│   ├── worker.ts                # Ephemeral worker lifecycle
│   ├── validator.ts             # Paired validator lifecycle
│   └── research.ts              # Read-only research subagent lifecycle
│
├── orchestrator/
│   ├── planner.ts               # Mission → milestones + validation contracts
│   ├── negotiator.ts            # Read verdicts, decide pass/retry/rescope
│   ├── overlap.ts               # Git-based overlap detection with scope union
│   ├── milestone-loop.ts        # Main execution loop per milestone
│   └── worktree.ts              # Git worktree create/merge/prune lifecycle
│
├── enforcement/
│   ├── handoff-validator.ts     # Structural handoff validation
│   ├── branch-guard.ts          # Git hook setup + branch permission checks
│   ├── broadcast-lifecycle.ts   # Transition graph + actor authorization
│   ├── research-lifecycle.ts    # Epistemic transitions + standing checks
│   ├── contract-immutability.ts # Append-only validation contract writes
│   └── creator-verifier.ts      # Session ID audit for separation guarantee
│
├── routes/
│   ├── missions.ts              # REST: create, get, list missions
│   └── checkpoints.ts           # REST: submit checkpoint decisions
│
├── ws/
│   └── events.ts                # WebSocket: status updates, escalation events
│
├── skills/                      # Skill files loaded into Pi SDK sessions
│   ├── shared/
│   │   └── principles.md        # ~70 lines (hard cap)
│   ├── orchestrator.md          # ~250 lines (hard cap)
│   ├── worker.md                # ~150 lines (hard cap)
│   ├── validator.md             # ~150 lines combined (hard cap). One file with conditional sections per validator type. Split into validator-scrutiny.md + validator-user-testing.md (75 lines each) if prompts diverge.
│   └── research.md              # ~80 lines (hard cap)
│
└── types.ts                     # Shared TypeScript types
```

### 4b. Dependency Flow

```
server.ts
  ├── lapis-client.ts ────────── (all data access)
  ├── pinyx-client.ts ────────── (all LLM calls)
  │
  ├── routes/missions.ts
  │     └── orchestrator/planner.ts
  │           ├── agents/factory.ts
  │           ├── enforcement/branch-guard.ts
  │           └── orchestrator/overlap.ts
  │
  ├── routes/checkpoints.ts
  │     └── orchestrator/negotiator.ts
  │
  ├── orchestrator/milestone-loop.ts
  │     ├── agents/worker.ts (spawn) ──── enforcement/handoff-validator.ts
  │     ├── agents/validator.ts (spawn)  enforcement/broadcast-lifecycle.ts
  │     ├── agents/research.ts (spawn) ── enforcement/research-lifecycle.ts
  │     ├── orchestrator/worktree.ts ──── enforcement/branch-guard.ts
  │     └── enforcement/*
  │
  └── ws/events.ts
        └── streams: agent_status, milestone_progress, cost, escalation
```

Note: `agents/worker.ts` and `agents/research.ts` call through enforcement for lifecycle transitions during execution, not just at milestone loop gates.

### 4c. Removed from Current Codebase

| Current File | Replaced By |
|---|---|
| `db.ts` (direct SQLite) | `lapis-client.ts` (HTTP) |
| `router-client.ts` | `pinyx-client.ts` |
| `clients/lapis-client.ts` (CLI subprocess) | New `lapis-client.ts` (HTTP) |
| `migrator.ts` | LaPis manages its own schema |
| `events.ts` (Node EventEmitter) | `ws/events.ts` (WebSocket) |

### 4d. Key Design Decisions

1. **Enforcement as a separate module** — all runtime constraint enforcement isolated in `enforcement/`. Testable independently, keeps rules out of orchestration logic.
2. **Skills live in the backend** — loaded into Pi SDK sessions via `ResourceLoader`. Not in `shared/` (frontend doesn't need agent behavior definitions).
3. **LaPis client is the only data surface** — every module goes through `lapis-client.ts`. No module imports `better-sqlite3`.
4. **No more `better-sqlite3` dependency** — removed from backend.

---

## 5. Frontend Architecture

### 5a. Component Structure

```
packages/frontend/src/
├── main.tsx                     # App entry
├── App.tsx                      # Root: WS connection, passive/active routing
│
├── hooks/
│   ├── useWebSocket.ts          # Connection to backend WS, event stream
│   └── useMission.ts            # Mission state: REST hydration + WS incremental
│
├── passive/                     # Default state — glanceable monitor
│   ├── StatusBoard.tsx          # Main layout: agent grid + milestone bar + cost
│   ├── AgentGrid.tsx            # Grid of animated agent nodes
│   ├── AgentNode.tsx            # Single agent: type icon, status, spinner
│   ├── MilestoneBar.tsx         # Current milestone progress
│   ├── CostCounter.tsx          # Running total with anime.js counter
│   └── StatusFeed.tsx           # Scrollable recent events
│
├── active/                      # Escalation state — demands attention
│   ├── EscalationOverlay.tsx    # Modal wrapper with anime.js entrance/exit
│   ├── CheckpointPanel.tsx      # Context display per trigger kind
│   ├── AttemptHistory.tsx       # Full retry/rescope history (rescope_limit only)
│   └── DecisionActions.tsx      # Approve / Reject / Rescope buttons
│
├── animations/
│   ├── agent-animations.ts      # createPulse(), createSpin(), createIdle()
│   ├── state-transitions.ts     # enterActive(), exitActive(), dimPassive(), restorePassive()
│   ├── counters.ts              # animateCounter(), animateProgress()
│   └── stagger.ts               # staggerEntrance(), staggerExit()
│
├── api.ts                       # REST client (hydration + checkpoint submission)
├── types.ts                     # TypeScript types (from shared package)
└── styles.css                   # Tailwind base + custom properties
```

### 5b. CheckpointPanel Conditional Rendering

`CheckpointPanel` renders different content depending on the escalation trigger:

- **`milestone_complete`**: milestone summary, validation results, release branch name, cost summary.
  - **Approve** → `decision: "approve"` (merge to main)
  - **Reject** → `decision: "reject"` (abandon release)

- **`rescope_limit`**: full attempt history with each attempt's scope, outcome, and cost.
  - **Review & Rescope** → `decision: "rescope"` (decompose and re-plan)
  - **Abort Mission** → `decision: "reject"`, `reason: "abort"` (terminate mission)

- **`unclassifiable_error`**: the error, last attempt context, what the Orchestrator tried.
  - **Retry with modified scope** → `decision: "rescope"`, `guidance: <modified scope>`
  - **Abort Mission** → `decision: "reject"`, `reason: "abort"`
  - **Provide Guidance** → `decision: "rescope"`, `guidance: <free-text broadcast injection>`

**Action-to-decision mapping**: all UI actions map to the three `CheckpointDecision` values (`approve`, `reject`, `rescope`). The `guidance` and `reason` fields carry action-specific context. There are no hidden decision types.

### 5c. WebSocket Event Contract

```typescript
type WsClientEvent =
  | { type: "agent_status"; agentId: string; agentType: AgentType; status: AgentStatus; milestoneId: string }
  | { type: "milestone_progress"; milestoneId: string; status: MilestoneStatus; completedUnits: number; totalUnits: number }
  | { type: "cost_update"; missionId: string; totalCost: number; totalTokens: number; delta: number }
  | { type: "escalation"; missionId: string; trigger: EscalationTrigger; context: EscalationContext }

type EscalationTrigger =
  | { kind: "milestone_complete"; milestoneId: string; releaseBranch: string }
  | { kind: "rescope_limit"; milestoneId: string; attemptHistory: AttemptSummary[] }
  | { kind: "unclassifiable_error"; milestoneId: string; error: string; lastAttempt: string }
```

### 5d. Passive → Active State Machine

```
┌─────────────────────────────────────────────┐
│                PASSIVE STATE                 │
│                                             │
│  AgentGrid (animated nodes)                 │
│  MilestoneBar (progress)                    │
│  CostCounter (ticking)                      │
│  StatusFeed (scrolling)                     │
│                                             │
└──────────────────┬──────────────────────────┘
                   │
                   │  WS event: "escalation"
                   │  (anime.js: overlay slides in,
                   │   passive view blurs/dims)
                   ▼
┌─────────────────────────────────────────────┐
│                ACTIVE STATE                 │
│                                             │
│  EscalationOverlay (modal)                  │
│  ├── CheckpointPanel (trigger-specific)     │
│  ├── AttemptHistory (if rescope_limit)      │
│  └── DecisionActions                        │
│        ├── Approve → POST /api/missions/:id/checkpoints      │
│        ├── Reject  → POST /api/missions/:id/checkpoints      │
│        └── Rescope → POST /api/missions/:id/checkpoints      │
│                                             │
└──────────────────┬──────────────────────────┘
                   │
                   │  Decision submitted
                   │  (anime.js: overlay exits,
                   │   passive view restores)
                   ▼
                PASSIVE STATE
```

### 5e. anime.js Usage

| Animation | Component | Purpose |
|---|---|---|
| Agent node pulse/spin | `AgentNode.tsx` | Working = spinning, Reviewing = pulsing, Researching = scanning, Idle/still = static |
| Grid stagger entrance | `AgentGrid.tsx` | New agents appear with staggered fade-in |
| Cost counter tick | `CostCounter.tsx` | Number animates to new value |
| Milestone progress | `MilestoneBar.tsx` | Width transitions smoothly |
| Escalation overlay enter | `EscalationOverlay.tsx` | Slides up + scales from center |
| Escalation overlay exit | `EscalationOverlay.tsx` | Slides down + fades |
| Passive dim on escalate | `StatusBoard.tsx` | Blurs and dims when active state triggers |
| Passive restore | `StatusBoard.tsx` | Unblurs when returning to passive |
| Status feed item | `StatusFeed.tsx` | New items slide in from top with fade |

### 5f. What the Frontend Does NOT Do

- No code diff viewing (enhancement, not load-bearing)
- No streaming logs panel (enhancement, not load-bearing)
- No agent configuration UI (config files / shared state)
- No direct LaPis or PiNyx access (backend is the only data source)

---

## 6. API Surface

### 6a. REST Endpoints

```
POST   /api/missions                    Create mission, activate Orchestrator
GET    /api/missions/current            Hydration: active mission + full state
GET    /api/missions/:id                Mission detail + milestones + active workers
GET    /api/missions?status=running     List missions by status
POST   /api/missions/:id/checkpoints    Submit checkpoint decision (idempotent)
GET    /health                          Healthcheck (checks LaPis + PiNyx)
```

**`POST /api/missions`**: accepts `{ description: string }`. Returns `{ missionId, status: "planning" }`.

**`POST /api/missions/:id/checkpoints`**: idempotent via `checkpointId` (UUID from frontend):
```typescript
{
  checkpointId: string;        // Frontend-generated UUID for dedup
  decision: "approve" | "reject" | "rescope";
  guidance?: string;           // For rescope
  reason?: string;             // For reject
}
// Returns { accepted: boolean; duplicate?: boolean; }
```

### 6b. WebSocket Channels

Single WebSocket at `/ws`. Typed JSON frames.

**Server → Client:**

| Event | Payload | Frequency |
|---|---|---|
| `agent_status` | agentId, agentType, status, milestoneId | Every agent state change |
| `milestone_progress` | milestoneId, status, completedUnits/totalUnits | On unit completion |
| `cost_update` | missionId, totalCost, totalTokens, delta | Every PiNyx call |
| `escalation` | missionId, trigger (kind-specific), context | On checkpoint triggers |

**Client → Server:**

| Event | Payload | When |
|---|---|---|
| `subscribe_mission` | missionId | On connect / mission select |
| `checkpoint_decision` | missionId, checkpointId, decision, guidance?, reason? | On user action |

REST and WS checkpoint paths trigger the same handler. REST is primary. WS is for low-latency when user is already in modal. `checkpointId` deduplicates across both paths.

### 6c. LaPis Client API (internal)

```typescript
interface LaPisClient {
  // Mission state
  createMission(description: string, config: MissionConfig): Promise<Mission>;
  getMission(id: string): Promise<Mission>;
  updateMissionStatus(id: string, status: MissionStatus): Promise<void>;

  // Milestones
  createMilestone(missionId: string, milestone: MilestoneSpec): Promise<Milestone>;
  updateMilestoneStatus(id: string, status: MilestoneStatus): Promise<void>;

  // Working units
  createWorkingUnit(milestoneId: string, unit: WorkingUnitSpec): Promise<WorkingUnit>;
  updateWorkingUnitStatus(id: string, status: WorkerStatus): Promise<void>;

  // Handoffs (with structural validation)
  writeHandoff(unitId: string, handoff: Handoff): Promise<HandoffResult>;

  // Validation contracts (append-only)
  createContract(milestoneId: string, contract: ValidationContract): Promise<Contract>;
  supersedeContract(oldId: string, newContract: ValidationContract, rescopeEvent: RescopeEvent): Promise<Contract>;
  getContractHistory(milestoneId: string): Promise<Contract[]>;

  // Validation verdicts
  writeVerdict(sessionId: string, verdict: Omit<ValidationVerdict, "id" | "sessionId">): Promise<ValidationVerdict>;
  classifyVerdict(verdictId: string, classification: "patchable" | "blocking"): Promise<ValidationVerdict>;
  getVerdicts(milestoneId: string): Promise<ValidationVerdict[]>; // Full chain for AttemptHistory

  // Broadcasts (with lifecycle enforcement)
  writeBroadcast(agentId: string, broadcast: Broadcast): Promise<Broadcast>;
  transitionBroadcast(broadcastId: string, newStatus: BroadcastLifecycle, actorId: string): Promise<Broadcast>;
  getBroadcasts(missionId: string, opts?: { status?: BroadcastLifecycle[] }): Promise<Broadcast[]>;

  // Research findings (with lifecycle + standing enforcement)
  writeFinding(agentId: string, finding: ResearchFinding): Promise<ResearchFinding>;
  transitionFinding(findingId: string, newStatus: ResearchLifecycle, actorId: string, actorContext?: StandingContext): Promise<ResearchFinding>;
  getFindings(missionId: string, status?: ResearchLifecycle): Promise<ResearchFinding[]>;

  // Agent sessions (Creator-Verifier audit)
  registerAgentSession(agentType: AgentType, sessionId: string, missionId: string, milestoneId?: string, unitId?: string): Promise<void>;
  getSessionsForMilestone(milestoneId: string): Promise<AgentSessionRecord[]>;

  // Memory (orchestrator-level, NOT memory-layer extension)
  searchMemory(query: string, opts?: { limit?: number }): Promise<MemoryResult[]>;

  // Cost tracking
  logCost(entry: CostEntry): Promise<void>;
  getMissionCost(missionId: string): Promise<CostSummary>;

  // Retry / rescope
  incrementRetry(milestoneId: string): Promise<RetryCounter>;
  logRescope(milestoneId: string, event: RescopeEvent): Promise<void>;

  // State compression (stubbed — logs skip with trigger and missionId, never silent)
  // Example log: [compression] Skipped — not implemented (trigger: post_milestone, missionId: abc)
  runCompression(missionId: string, trigger: CompressionTrigger): Promise<void>;

  // Connectivity
  ping(): Promise<void>;
}
```

`supersedeContract` atomically writes the new contract and rescope event in one transaction — intentional coupling per spec §5 (rescope event mandatory when superseding).

**Checkpoint dedup semantics**: Frontend generates `checkpointId` (UUID) before any submission. First submission processed normally → `{ accepted: true }`. Submissions with same `checkpointId` → `{ accepted: true, duplicate: true }` (decision already applied). Frontend shows success on duplicate, does not re-submit. New `checkpointId` per escalation event, never reused.

**Human guidance broadcasts**: when a human provides guidance via `unclassifiable_error` checkpoint: `authorId: "human"`, `authorType: "orchestrator"`, `category: "decision"`, `ttl: null` (no auto-expiry). Human acts through Orchestrator authority channel. Lifecycle rules still apply.

**Note for Creator-Verifier audit**: the `authorId` value `"human"` is a known non-session actor. `creator-verifier.ts` must handle this explicitly — do not look up `"human"` in `agent_sessions` or the audit will produce spurious failures on every human guidance broadcast. Human guidance broadcasts are exempt from Creator-Verifier session checks by definition.

---

## 7. Error Handling & Retry Rules

### 7a. Error Hierarchy

```
Recoverable Errors
├── Worker timeout              → discard, spawn fresh
├── Handoff validation fail     → mark incomplete, re-run
├── Validator retry             → ≤2 retries per milestone
└── Minor git merge conflict    → targeted Worker fix

Escalated Errors
├── 5x re-scope limit hit       → human checkpoint
├── 2x consecutive timeout      → auto-rescope to smaller unit
├── User Testing fail           → always blocks (override authority)
└── Unclassifiable error        → human checkpoint

Terminal Errors
├── Human aborts mission        → cleanup, set status to "aborted"
└── Unrecoverable git state     → set status to "failed", surface to human
```

### 7b. Retry & Re-scope Rules

| Rule | Trigger | Action | Counter |
|---|---|---|---|
| Worker timeout | Exceeds task-type limit | Discard, spawn fresh | 2 consecutive → auto-rescope |
| Handoff invalid | Structural validation fails | Mark incomplete, re-run | 2 consecutive on same unit → auto-rescope |
| Validator retry | Validation fails | Re-spawn failed units | ≤2 per milestone |
| Re-scope | Retry exhausted / persistent drift | Decompose, new contract | ≤5 per milestone |
| 5x re-scope | 6th re-scope needed | **Escalate to human** | Hard limit |
| Scrutiny-only fail | Orchestrator classifies | Blocking → full retry; Patchable → targeted Worker | Per classification |
| User Testing fail | Any | **Always blocks** | Override authority |

**Patchable vs blocking criteria** (lives in `orchestrator.md`):
- **Patchable**: failure isolated to specific unit, doesn't invalidate contract, targeted fix sufficient
- **Blocking**: contract-level or cross-unit issue, requires re-running milestone

### 7c. Error Event Flow

```
Worker fails
    │
    ├── Timeout?
    │     └── 2nd consecutive on same unit?
    │           ├── No → spawn fresh Worker, increment retry
    │           └── Yes → auto-rescope to smaller unit
    │
    ├── Handoff validation failed?
    │     └── 2nd consecutive on same unit?
    │           ├── No → re-run same spec (retry counter++)
    │           └── Yes → auto-rescope to smaller unit (re-scope counter++)
    │
    └── Completed but validator fails
          ├── User Testing failed?
          │     └── Yes → ALWAYS blocks (Scrutiny irrelevant)
          │          └── Full retry (counter++)
          │
          ├── Scrutiny only?
          │     └── Orchestrator classifies
          │           ├── Patchable → spawn targeted Worker
          │           └── Blocking → full retry (counter++)
          │
          ├── Retry counter ≤ 2?
          │     ├── Yes → retry
          │     └── No → re-scope (counter++)
          │
          └── Re-scope counter ≤ 5?
                ├── Yes → decompose, new contract, re-run
                └── No → ESCALATE TO HUMAN
```

### 7d. Cost Guardrails

- **Mission cost cap**: configurable per mission. Exceeds → pause + escalate.
- **Milestone cost alert**: >40% of mission budget → broadcast warning to Orchestrator (NOT human escalation). Orchestrator factors into next milestone planning.
- **Per-agent cost tracking**: disproportionate cost signals stuck/confused agent.

### 7e. What the Runtime Does NOT Retry

- Human abort decisions (terminal)
- Git state corruption (terminal, requires human)
- LaPis write failures (infrastructure error, mission pauses)
- PiNyx connectivity failures (infrastructure error, mission pauses)

---

## 8. Configuration & Deployment

### 8a. Configuration (env vars)

```bash
# LaPis (shared state) — HTTP only, no direct DB path
LAPIS_ENDPOINT=http://localhost:9100

# PiNyx (LLM gateway)
PINYX_ENDPOINT=http://localhost:7331

# Agent models (PiNyx routing hints)
MODEL_ORCHESTRATOR=reasoning-strong
MODEL_WORKER=code-fast
MODEL_VALIDATOR_SCRUTINY=reasoning
MODEL_VALIDATOR_USER_TESTING=computer-use
MODEL_RESEARCH=fast-cheap

# Agent timeouts (ms)
WORKER_TIMEOUT_SIMPLE=120000
WORKER_TIMEOUT_BUILD=300000
WORKER_TIMEOUT_TEST_HEAVY=600000
VALIDATOR_TIMEOUT=180000
RESEARCH_TIMEOUT=120000

# Mission limits
MAX_VALIDATOR_RETRIES=2
MAX_RESCOPES_PER_MILESTONE=5
MISSION_COST_CAP=50.00

# Git
REPO_ROOT=/path/to/target/repo
GIT_MAIN_BRANCH=main

# Server
PORT=3000
WS_PORT=3001
```

### 8b. Docker Compose

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

**Docker socket NOT mounted** — agents don't need Docker access. Added only if future need arises with explicit security documentation.

**Git worktree permissions**: container user UID matches host repo owner. `git config --global safe.directory '*'` in Dockerfile. Entrypoint handles `chown` if UID mismatch unavoidable.

### 8c. Deployment Model

```
Host Machine
├── PiNyx (systemd, :7331)                    # LLM gateway
├── LaPis (background, :9100)                 # Shared state service
├── Target Repo (/workspace)                  # Codebase being worked on
│
└── Docker
    ├── aurex-backend (:3000, :3001)          # Fastify + WebSocket
    │     └── Spawns Pi SDK sessions in-process
    │     └── Creates git worktrees under /workspace
    └── aurex-frontend (:5173)                # React dashboard
```

**Startup healthchecks** in `server.ts`: `lapisClient.ping()` and `pinyxClient.ping()` must succeed before accepting traffic. `/health` returns 503 if either dependency is down post-startup.

**In-process Pi SDK isolation**: Workers are ephemeral — `session.abort()` on timeout, `session.dispose()` for cleanup. Backend doesn't kill its own process; it abandons the session and continues.

---

## 9. Shared Package & Type System

### 9a. Enums

```typescript
type MissionStatus = "planning" | "running" | "paused" | "completed" | "failed" | "aborted";
type MilestoneStatus = "planned" | "in_progress" | "validating" | "completed" | "failed";
type AgentStatus = "spawned" | "planning" | "working" | "reviewing" | "researching" | "committing" | "completed" | "timed_out" | "failed";
type WorkerStatus = "spawned" | "working" | "committing" | "completed" | "timed_out" | "failed";
type AgentType = "orchestrator" | "worker" | "validator_scrutiny" | "validator_user_testing" | "research";
type NegotiatorVerdict = "pass" | "retry" | "rescope" | "escalate";

type BroadcastLifecycle = "active" | "superseded" | "archived" | "expired";
type BroadcastCategory = "info" | "warning" | "decision" | "constraint";

type ResearchLifecycle = "unverified" | "verified" | "superseded" | "rejected" | "expired";
type ResearchRelevance = "high" | "medium" | "low";

type CheckpointTrigger = "milestone_complete" | "rescope_limit" | "unclassifiable_error";
type CheckpointDecision = "approve" | "reject" | "rescope";
```

### 9b. Core Types

```typescript
interface Mission {
  id: string;
  description: string;
  status: MissionStatus;
  configJson: MissionConfig;
  createdAt: string;
}

interface MissionConfig {
  modelHints: Record<AgentType, string>;
  workerTimeouts: { simple: number; build: number; testHeavy: number; };
  costCap: number;
  maxValidatorRetries: number;
  maxRescopes: number;
}

interface Milestone {
  id: string;
  missionId: string;
  title: string;
  description: string;
  orderIndex: number;
  status: MilestoneStatus;
  validationContractId: string;
}

interface WorkingUnit {
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

interface ValidationContract {
  id: string;
  milestoneId: string;
  version: number;
  content: ValidationContractContent;
  supersedes: string | null;
  supersededBy: string | null;
  rescopeEventId: string | null;
  createdAt: string;
}

interface Handoff {
  unitId: string;
  featureName: string;
  description: string;
  implemented: string;
  remaining: string;
  rationale: string;              // Detailed. "Refactored X" is NOT valid.
  assumptions: string;
  unresolvedUncertainties: string; // "none" is valid. Absent is NOT valid.
  errorsEncountered: string;
  commandsRun: { command: string; exitCode: number; }[];
  gitCommitHash: string;
}

interface Broadcast {
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

interface ResearchFinding {
  id: string;
  missionId: string;
  authorId: string;
  domain: string[];               // Tagged modules for standing check
  title: string;
  content: string;
  relevance: ResearchRelevance;
  status: ResearchLifecycle;
  verifiedTaskId: string | null;   // Worker task ID (durable reference for standing checks)
  ttl: number | null;
  expiresAt: string | null;
  createdAt: string;
}

interface AgentSessionRecord {
  sessionId: string;
  agentType: AgentType;
  missionId: string;
  milestoneId: string | null;
  unitId: string | null;
  spawnedAt: string;
  terminatedAt: string | null;
}

interface CostEntry {
  id: string;
  missionId: string;
  agentSessionId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  cost: number;
  timestamp: string;
}

interface RescopeEvent {
  id: string;
  milestoneId: string;
  contractId: string;
  reason: string;
  previousScope: string;
  newScope: string;
  timestamp: string;
}

interface ValidationVerdict {
  id: string;
  milestoneId: string;
  contractId: string;
  validatorType: "validator_scrutiny" | "validator_user_testing";
  sessionId: string;
  verdict: "pass" | "fail";
  classification?: "patchable" | "blocking";  // Set by Orchestrator via classifyVerdict(), not by Validator
  findings: string;
  failedUnitIds: string[];
  timestamp: string;
}
```

### 9c. REST Types

```typescript
interface CreateMissionRequest { description: string; }
interface CreateMissionResponse { missionId: string; status: MissionStatus; }
interface GetMissionResponse { mission: Mission; milestones: Milestone[]; activeWorkers: WorkingUnit[]; cost: CostSummary; }
interface CheckpointRequest { checkpointId: string; decision: CheckpointDecision; guidance?: string; reason?: string; }
interface CheckpointResponse { accepted: boolean; duplicate?: boolean; }
```

### 9d. Changes from Current Code

| Current | New | Reason |
|---|---|---|
| Loose `Handoff` type | Structured with required fields, commands array | Runtime enforcement |
| `ValidationContract` plain object | Append-only with versioning | Immutability |
| No `authorId`/`authorType` on broadcasts | Added | Lifecycle authorization |
| No `domain` on research findings | Added | Standing check |
| No `AgentSessionRecord` | Added | Creator-Verifier audit |
| No `ttl`/`expiresAt` on broadcasts/findings | Added | Auto-expiry |
| `MissionConfig` inline | Extracted with model hints, timeouts | Configurable per mission |
| Generic `WsEvent<T>` wrapper | Flat discriminated union | Consistency |
