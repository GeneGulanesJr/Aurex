import { describe, it, expect } from "vitest";
import { buildValidatorContext, buildWorkerContext, buildResearchContext } from "../../src/agents/context-builder";
import type { ResearchFinding } from "@aurex/shared";

describe("buildWorkerContext", () => {
  it("includes mission description", () => {
    const ctx = buildWorkerContext({
      missionDescription: "Build user authentication",
      milestoneTitle: "Auth module",
      milestoneDescription: "Implement JWT auth",
      unitDescription: "Create login endpoint",
      unitDeclaredPaths: ["src/auth/login.ts"],
      unitDeclaredModules: ["auth"],
      contractCriteria: ["Login returns JWT", "Token expires in 1h"],
      testCommands: ["npm test -- --grep login"],
    });
    expect(ctx).toContain("Build user authentication");
    expect(ctx).toContain("Auth module");
    expect(ctx).toContain("Create login endpoint");
    expect(ctx).toContain("src/auth/login.ts");
    expect(ctx).toContain("auth");
    expect(ctx).toContain("Login returns JWT");
    expect(ctx).toContain("npm test -- --grep login");
  });

  it("includes scope constraint warning", () => {
    const ctx = buildWorkerContext({
      missionDescription: "Fix bug",
      milestoneTitle: "Fix",
      milestoneDescription: "Fix the bug",
      unitDescription: "Fix null pointer",
      unitDeclaredPaths: ["src/foo.ts"],
      unitDeclaredModules: ["foo"],
      contractCriteria: ["No crash"],
      testCommands: ["npm test"],
    });
    expect(ctx).toContain("SCOPE CONSTRAINT");
    expect(ctx).toContain("src/foo.ts");
  });

  it("includes handoff format reminder", () => {
    const ctx = buildWorkerContext({
      missionDescription: "X",
      milestoneTitle: "Y",
      milestoneDescription: "Z",
      unitDescription: "W",
      unitDeclaredPaths: [],
      unitDeclaredModules: [],
      contractCriteria: [],
      testCommands: [],
    });
    expect(ctx).toContain("HANDOFF");
  });

  it("formats test commands as numbered list", () => {
    const ctx = buildWorkerContext({
      missionDescription: "X",
      milestoneTitle: "Y",
      milestoneDescription: "Z",
      unitDescription: "W",
      unitDeclaredPaths: [],
      unitDeclaredModules: [],
      contractCriteria: [],
      testCommands: ["npm test", "npm run lint"],
    });
    expect(ctx).toContain("1. `npm test`");
    expect(ctx).toContain("2. `npm run lint`");
  });

  it("omits the Affected Code section when affectedCode is absent (backward-compatible)", () => {
    const ctx = buildWorkerContext({
      missionDescription: "X",
      milestoneTitle: "Y",
      milestoneDescription: "Z",
      unitDescription: "W",
      unitDeclaredPaths: ["src/foo.ts"],
      unitDeclaredModules: ["foo"],
      contractCriteria: [],
      testCommands: [],
    });
    expect(ctx).not.toContain("Affected Code (Map)");
  });

  it("renders the Affected Code (Map) section when affectedCode is present", () => {
    const ctx = buildWorkerContext({
      missionDescription: "X",
      milestoneTitle: "Y",
      milestoneDescription: "Z",
      unitDescription: "W",
      unitDeclaredPaths: ["src/foo.ts"],
      unitDeclaredModules: ["foo"],
      contractCriteria: [],
      testCommands: [],
      affectedCode: {
        unitId: "u1",
        nodes: [{ id: "src/foo.ts", module: "foo", symbols: 4, importance: 9 }],
        edges: [{ from: "src/foo.ts", to: "src/bar.ts", kind: "imports" }],
        hotspots: [{ path: "src/foo.ts", module: "foo", complexity: 7, symbols: 4 }],
        tokenBudget: 60,
        truncated: false,
      },
    });
    expect(ctx).toContain("Affected Code (Map)");
    expect(ctx).toContain("src/foo.ts");
    expect(ctx).toContain("src/foo.ts → src/bar.ts");
    expect(ctx).toContain("Hotspots — review these first");
  });

  it("notes truncation in the Affected Code section when truncated is true", () => {
    const ctx = buildWorkerContext({
      missionDescription: "X",
      milestoneTitle: "Y",
      milestoneDescription: "Z",
      unitDescription: "W",
      unitDeclaredPaths: [],
      unitDeclaredModules: [],
      contractCriteria: [],
      testCommands: [],
      affectedCode: {
        unitId: "u1",
        nodes: [],
        edges: [],
        hotspots: [],
        tokenBudget: 40,
        truncated: true,
      },
    });
    expect(ctx).toContain("trimmed to token budget");
  });
});

describe("buildResearchContext", () => {
  it("includes mission and milestone context", () => {
    const ctx = buildResearchContext({
      missionDescription: "Build user authentication",
      milestoneTitle: "Auth module",
      milestoneDescription: "Implement JWT auth",
      unitDescriptions: ["Create login endpoint", "Create register endpoint"],
      declaredPaths: ["src/auth/**"],
      declaredModules: ["auth"],
    });
    expect(ctx).toContain("Build user authentication");
    expect(ctx).toContain("Auth module");
    expect(ctx).toContain("Create login endpoint");
    expect(ctx).toContain("src/auth/**");
    expect(ctx).toContain("auth");
  });

  it("includes finding submission instructions", () => {
    const ctx = buildResearchContext({
      missionDescription: "X",
      milestoneTitle: "Y",
      milestoneDescription: "Z",
      unitDescriptions: [],
      declaredPaths: [],
      declaredModules: [],
    });
    expect(ctx).toContain("write_finding");
    expect(ctx).toContain("FINDINGS");
  });
});

describe("buildValidatorContext", () => {
  it("adds anti-hallucination review instructions for scrutiny validators", () => {
    const ctx = buildValidatorContext({
      validatorType: "validator_scrutiny",
      missionDescription: "Ship review flow",
      milestoneTitle: "Review prompt",
      milestoneDescription: "Make validators stricter",
      contractId: "contract-1",
      contractCriteria: ["Only grounded issues are reported"],
      testCommands: [],
      acceptanceBehavior: "",
      baseBranch: "develop",
      units: [],
    });

    expect(ctx).toContain("Single Scoped Feature Review");
    expect(ctx).toContain("Do not introduce new requirements");
    expect(ctx).toContain("False positives are costly");
    expect(ctx).toContain("Do not report speculative issues as bugs");
    expect(ctx).toContain("Inputs available to this validator");
    expect(ctx).toContain("Decision model");
    expect(ctx).toContain("needs changes");
    expect(ctx).toContain("escalate");
    expect(ctx).toContain("## Possible risks");
    expect(ctx).toContain("## Optional suggestions");
    expect(ctx).toContain("## Missing context");
    expect(ctx).toContain("## Tests to add or update");
    expect(ctx).toContain("use `failedUnitIds` only for units with confirmed failures");
  });

  it("does not add scrutiny review instructions for user-testing validators", () => {
    const ctx = buildValidatorContext({
      validatorType: "validator_user_testing",
      missionDescription: "Ship review flow",
      milestoneTitle: "Review prompt",
      milestoneDescription: "Make validators stricter",
      contractId: "contract-1",
      contractCriteria: [],
      testCommands: [],
      acceptanceBehavior: "User can complete checkout",
      baseBranch: "develop",
      units: [],
    });

    expect(ctx).not.toContain("Single Scoped Feature Review");
    expect(ctx).toContain("describe the broken user-visible behavior");
  });

  it("includes full handoff records from LaPis", () => {
    const ctx = buildValidatorContext({
      validatorType: "validator_scrutiny",
      missionDescription: "Build user authentication",
      milestoneTitle: "Auth module",
      milestoneDescription: "Implement JWT auth",
      contractId: "contract-1",
      contractCriteria: ["Login returns JWT"],
      testCommands: ["npm test"],
      acceptanceBehavior: "",
      baseBranch: "main",
      units: [
        {
          id: "unit-1",
          description: "Create login endpoint",
          declaredPaths: ["src/auth/login.ts"],
          declaredModules: ["auth"],
          taskBranch: "task/worker-unit-1",
          worktreePath: "/tmp/worktree",
          handoff: {
            id: "handoff-1",
            missionId: "m-1",
            milestoneId: "ms-1",
            unitId: "unit-1",
            status: "accepted",
            featureName: "Login",
            description: "Login endpoint",
            implemented: "POST /login returns JWT",
            remaining: "none",
            rationale: "JWT keeps the API stateless while matching the contract.",
            assumptions: "Password verification exists",
            unresolvedUncertainties: "none",
            errorsEncountered: "none",
            commandsRun: [{ command: "npm test", exitCode: 0 }],
            gitCommitHash: "abc123",
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          },
        },
      ],
    });

    expect(ctx).toContain("Record ID: handoff-1");
    expect(ctx).toContain("Status: accepted");
    expect(ctx).toContain("Implemented: POST /login returns JWT");
    expect(ctx).toContain("Rationale: JWT keeps the API stateless");
    expect(ctx).toContain("Commands run: npm test (exit 0)");
    expect(ctx).toContain("Git commit: abc123");
  });

  it("includes research findings in worker context when provided", () => {
    const findings: ResearchFinding[] = [
      { id: "f-1", missionId: "m-1", authorId: "r-1", domain: ["auth"], title: "JWT pattern", content: "Uses RS256 signing", relevance: "high", status: "unverified", verifiedTaskId: null, ttl: null, expiresAt: null, createdAt: "" },
    ];
    const ctx = buildWorkerContext({
      missionDescription: "Build auth",
      milestoneTitle: "Auth",
      milestoneDescription: "Auth module",
      unitDescription: "Login",
      unitDeclaredPaths: [],
      unitDeclaredModules: [],
      contractCriteria: [],
      testCommands: [],
      researchFindings: findings,
    });
    expect(ctx).toContain("Research Findings");
    expect(ctx).toContain("JWT pattern");
    expect(ctx).toContain("Uses RS256 signing");
  });

  it("excludes rejected and expired research findings", () => {
    const findings: ResearchFinding[] = [
      { id: "f-1", missionId: "m-1", authorId: "r-1", domain: ["auth"], title: "Active finding", content: "Useful info", relevance: "high", status: "unverified", verifiedTaskId: null, ttl: null, expiresAt: null, createdAt: "" },
      { id: "f-2", missionId: "m-1", authorId: "r-1", domain: ["auth"], title: "Rejected finding", content: "Bad info", relevance: "low", status: "rejected", verifiedTaskId: null, ttl: null, expiresAt: null, createdAt: "" },
      { id: "f-3", missionId: "m-1", authorId: "r-1", domain: ["auth"], title: "Expired finding", content: "Old info", relevance: "low", status: "expired", verifiedTaskId: null, ttl: null, expiresAt: null, createdAt: "" },
    ];
    const ctx = buildWorkerContext({
      missionDescription: "Build auth",
      milestoneTitle: "Auth",
      milestoneDescription: "Auth module",
      unitDescription: "Login",
      unitDeclaredPaths: [],
      unitDeclaredModules: [],
      contractCriteria: [],
      testCommands: [],
      researchFindings: findings,
    });
    expect(ctx).toContain("Active finding");
    expect(ctx).not.toContain("Rejected finding");
    expect(ctx).not.toContain("Expired finding");
  });

  it("includes research findings in validator context when provided", () => {
    const findings: ResearchFinding[] = [
      { id: "f-1", missionId: "m-1", authorId: "r-1", domain: ["api"], title: "API contract", content: "Response format is JSON", relevance: "medium", status: "unverified", verifiedTaskId: null, ttl: null, expiresAt: null, createdAt: "" },
    ];
    const ctx = buildValidatorContext({
      validatorType: "validator_scrutiny",
      missionDescription: "Build API",
      milestoneTitle: "API",
      milestoneDescription: "API module",
      contractId: "c-1",
      contractCriteria: [],
      testCommands: [],
      acceptanceBehavior: "",
      baseBranch: "main",
      units: [],
      researchFindings: findings,
    });
    expect(ctx).toContain("Research Findings");
    expect(ctx).toContain("API contract");
    expect(ctx).toContain("Response format is JSON");
  });

  it("omits research findings section when no findings are provided", () => {
    const ctx = buildWorkerContext({
      missionDescription: "Build auth",
      milestoneTitle: "Auth",
      milestoneDescription: "Auth module",
      unitDescription: "Login",
      unitDeclaredPaths: [],
      unitDeclaredModules: [],
      contractCriteria: [],
      testCommands: [],
    });
    expect(ctx).not.toContain("Research Findings");
  });

  it("includes diff summary when provided", () => {
    const ctx = buildValidatorContext({
      validatorType: "validator_scrutiny",
      missionDescription: "Build auth",
      milestoneTitle: "Auth module",
      milestoneDescription: "JWT auth",
      contractId: "contract-1",
      contractCriteria: ["Login returns JWT"],
      testCommands: ["npm test"],
      acceptanceBehavior: "",
      baseBranch: "main",
      units: [],
      diffSummary: "diff --git a/src/auth.ts b/src/auth.ts\n+export function login() {}",
    });

    expect(ctx).toContain("## Changed Code (Diff)");
    expect(ctx).toContain("export function login()");
  });

  it("omits diff section when no diff provided", () => {
    const ctx = buildValidatorContext({
      validatorType: "validator_scrutiny",
      missionDescription: "Build auth",
      milestoneTitle: "Auth module",
      milestoneDescription: "JWT auth",
      contractId: "contract-1",
      contractCriteria: [],
      testCommands: [],
      acceptanceBehavior: "",
      baseBranch: "main",
      units: [],
    });

    expect(ctx).not.toContain("## Changed Code (Diff)");
  });

  it("includes merged worktree path and merge status when provided", () => {
    const ctx = buildValidatorContext({
      validatorType: "validator_scrutiny",
      missionDescription: "Build auth",
      milestoneTitle: "Auth module",
      milestoneDescription: "JWT auth",
      contractId: "contract-1",
      contractCriteria: ["Login returns JWT"],
      testCommands: ["npm test"],
      acceptanceBehavior: "",
      baseBranch: "main",
      units: [
        { id: "u-1", description: "auth", declaredPaths: [], declaredModules: [], taskBranch: "task/worker-a/u-1", worktreePath: "/repo/.git-worktrees/worker-a-u-1" },
        { id: "u-2", description: "db", declaredPaths: [], declaredModules: [], taskBranch: "task/worker-b/u-2", worktreePath: "/repo/.git-worktrees/worker-b-u-2" },
      ],
      validatorWorktree: {
        path: "/repo/.git-worktrees/validator-ms-1",
        mergedBranches: ["task/worker-a/u-1"],
        conflictedBranches: ["task/worker-b/u-2"],
      },
    });

    expect(ctx).toContain("## Merged Validation Worktree");
    expect(ctx).toContain("/repo/.git-worktrees/validator-ms-1");
    expect(ctx).toContain("Your `read` and `bash` tool calls operate from THIS directory.");
    expect(ctx).toContain("task/worker-b/u-2");
    expect(ctx).toContain("u-2");
  });

  it("omits merged worktree section when not provided", () => {
    const ctx = buildValidatorContext({
      validatorType: "validator_scrutiny",
      missionDescription: "Build auth",
      milestoneTitle: "Auth module",
      milestoneDescription: "JWT auth",
      contractId: "contract-1",
      contractCriteria: [],
      testCommands: [],
      acceptanceBehavior: "",
      baseBranch: "main",
      units: [],
    });

    expect(ctx).not.toContain("## Merged Validation Worktree");
  });

  it("does not claim a hard validator tool-call cap by default", () => {
    const ctx = buildValidatorContext({
      validatorType: "validator_scrutiny",
      missionDescription: "Build auth",
      milestoneTitle: "Auth module",
      milestoneDescription: "JWT auth",
      contractId: "contract-1",
      contractCriteria: [],
      testCommands: [],
      acceptanceBehavior: "",
      baseBranch: "main",
      units: [],
    });

    expect(ctx).toContain("There is no per-session tool-call cap");
    expect(ctx).not.toContain("You have a hard cap");
  });

  it("includes configured validator tool-call cap when present", () => {
    const ctx = buildValidatorContext({
      validatorType: "validator_scrutiny",
      missionDescription: "Build auth",
      milestoneTitle: "Auth module",
      milestoneDescription: "JWT auth",
      contractId: "contract-1",
      contractCriteria: [],
      testCommands: [],
      acceptanceBehavior: "",
      baseBranch: "main",
      units: [],
      validatorToolCallCap: 80,
    });

    expect(ctx).toContain("configured cap of 80 tool calls");
  });
});
