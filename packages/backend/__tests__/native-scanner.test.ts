import { describe, it, expect, vi, beforeEach } from "vitest";
import { join } from "path";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { nativeScan } from "../src/clients/native-scanner";
import type { ExposureCatalog } from "@aurex/shared";

describe("Native supply-chain scanner", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "native-scan-test-"));
  });

  async function cleanup() {
    await rm(testDir, { recursive: true, force: true });
  }

  async function writePackageJson(dir: string, pkg: Record<string, unknown>) {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "package.json"), JSON.stringify(pkg, null, 2), "utf-8");
  }

  it("collects packages from package.json dependencies", async () => {
    await writePackageJson(testDir, {
      name: "test-project",
      dependencies: {
        express: "^4.18.2",
        lodash: "^4.17.21",
      },
      devDependencies: {
        vitest: "^1.0.0",
      },
    });

    const result = await nativeScan(testDir, "scan-1", null);
    expect(result.packages.length).toBeGreaterThanOrEqual(3);
    expect(result.packages.some((p) => p.packageName === "express")).toBe(true);
    expect(result.packages.some((p) => p.packageName === "lodash")).toBe(true);
    expect(result.packages.some((p) => p.packageName === "vitest")).toBe(true);
    expect(result.packages.every((p) => p.ecosystem === "npm")).toBe(true);
    await cleanup();
  });

  it("deduplicates packages by name@version", async () => {
    await writePackageJson(join(testDir, "packages", "app-a"), {
      dependencies: { lodash: "^4.17.21" },
    });
    await writePackageJson(join(testDir, "packages", "app-b"), {
      dependencies: { lodash: "^4.17.21" },
    });

    const result = await nativeScan(testDir, "scan-2", null);
    const lodashCount = result.packages.filter((p) => p.packageName === "lodash").length;
    expect(lodashCount).toBe(1);
    await cleanup();
  });

  it("matches packages against exposure catalog", async () => {
    await writePackageJson(testDir, {
      dependencies: { "event-stream": "3.3.4" },
    });

    const catalog: ExposureCatalog = {
      schema_version: "1.0",
      entries: [
        {
          id: "evt-stream",
          name: "Malicious event-stream",
          ecosystem: "npm",
          package: "event-stream",
          versions: ["3.3"],
          severity: "critical",
        },
      ],
    };

    const result = await nativeScan(testDir, "scan-3", catalog);
    expect(result.findings.length).toBeGreaterThanOrEqual(1);
    const evtFinding = result.findings.find((f) => f.packageName === "event-stream");
    expect(evtFinding).toBeDefined();
    expect(evtFinding!.severity).toBe("critical");
    await cleanup();
  });

  it("skips workspace: and file: references", async () => {
    await writePackageJson(testDir, {
      dependencies: {
        "my-local-pkg": "workspace:*",
        "my-other-pkg": "file:../other",
        express: "^4.18.2",
      },
    });

    const result = await nativeScan(testDir, "scan-4", null);
    expect(result.packages.some((p) => p.packageName === "my-local-pkg")).toBe(false);
    expect(result.packages.some((p) => p.packageName === "my-other-pkg")).toBe(false);
    expect(result.packages.some((p) => p.packageName === "express")).toBe(true);
    await cleanup();
  });

  it("returns empty arrays for empty directories", async () => {
    await mkdir(join(testDir, "src"), { recursive: true });
    await writeFile(join(testDir, "src", "main.ts"), "console.log('hello')", "utf-8");

    const result = await nativeScan(testDir, "scan-5", null);
    expect(result.packages).toEqual([]);
    expect(result.findings).toEqual([]);
    await cleanup();
  });

  it("filters by ecosystem when specified", async () => {
    await writePackageJson(testDir, {
      dependencies: { express: "^4.18.2" },
    });

    const result = await nativeScan(testDir, "scan-6", null, ["pip"]);
    expect(result.packages).toEqual([]);
    await cleanup();
  });
});
