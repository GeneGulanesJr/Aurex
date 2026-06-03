import { describe, it, expect } from "vitest";
import { parseNdjsonLine } from "../src/clients/bumblebee-client.js";

describe("parseNdjsonLine", () => {
  it("parses valid JSON line", () => {
    const result = parseNdjsonLine('{"record_type":"package","package_name":"lodash"}');
    expect(result).toEqual({ record_type: "package", package_name: "lodash" });
  });

  it("returns null for empty lines", () => {
    expect(parseNdjsonLine("")).toBeNull();
    expect(parseNdjsonLine("   ")).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseNdjsonLine("not json")).toBeNull();
    expect(parseNdjsonLine("{broken")).toBeNull();
  });

  it("handles trailing newline", () => {
    const result = parseNdjsonLine('{"record_type":"finding"}\n');
    expect(result).toEqual({ record_type: "finding" });
  });
});
