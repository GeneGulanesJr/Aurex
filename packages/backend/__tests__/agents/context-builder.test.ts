import { describe, it, expect } from "vitest";
import { buildWorkerContext } from "../../src/agents/context-builder";

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
