import { describe, it, expect } from "vitest";
import { buildValidatorContext, buildWorkerContext } from "../../src/agents/context-builder";

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
});

describe("buildValidatorContext", () => {
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
});
