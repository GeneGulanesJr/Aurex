import { describe, it, expect } from "vitest";
import { parseCommandsRunJson, validateCommandsRunEntries } from "../src/enforcement/commands-run.js";

describe("commands-run validation", () => {
  it("accepts valid command entries", () => {
    const result = validateCommandsRunEntries([{ command: "npm test", exitCode: 0 }]);
    expect(result).toEqual({ ok: true, entries: [{ command: "npm test", exitCode: 0 }] });
  });

  it("rejects empty arrays", () => {
    const result = validateCommandsRunEntries([]);
    expect(result).toEqual({ ok: false, error: "commandsRun must contain at least one command" });
  });

  it("rejects non-object entries", () => {
    const result = validateCommandsRunEntries(["npm test"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("commandsRun[0]");
    }
  });

  it("rejects missing command", () => {
    const result = validateCommandsRunEntries([{ exitCode: 0 }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("command");
    }
  });

  it("rejects non-numeric exitCode", () => {
    const result = validateCommandsRunEntries([{ command: "npm test", exitCode: "0" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("exitCode");
    }
  });

  it("parses valid JSON", () => {
    const result = parseCommandsRunJson(JSON.stringify([{ command: "git commit", exitCode: 0 }]));
    expect(result.ok).toBe(true);
  });

  it("rejects invalid JSON", () => {
    const result = parseCommandsRunJson("not-json");
    expect(result.ok).toBe(false);
  });
});
