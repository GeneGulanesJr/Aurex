import { describe, it, expect } from "vitest";
import { resolveTheme, type ThemeId, VALID_THEMES } from "./useTheme";

describe("resolveTheme", () => {
  it("returns solar-flare for null input", () => {
    expect(resolveTheme(null)).toBe("solar-flare");
  });

  it("returns the theme if valid", () => {
    expect(resolveTheme("frost-command")).toBe("frost-command");
    expect(resolveTheme("signal-red")).toBe("signal-red");
    expect(resolveTheme("solar-flare")).toBe("solar-flare");
  });

  it("returns solar-flare for invalid theme", () => {
    expect(resolveTheme("neon-pink")).toBe("solar-flare");
    expect(resolveTheme("")).toBe("solar-flare");
  });
});

describe("VALID_THEMES", () => {
  it("contains exactly three themes", () => {
    expect(VALID_THEMES).toEqual(["solar-flare", "frost-command", "signal-red"]);
  });
});
