import { spawn } from "child_process";
import { randomUUID } from "crypto";
import type { BumblebeePackage, BumblebeeFinding, ExposureCatalog } from "@aurex/shared";
import { nativeScan } from "./native-scanner.js";

export interface BumblebeeScanOptions {
  root: string;
  profile: "baseline" | "project" | "deep";
  ecosystems?: string[];
  exposureCatalog?: string;
  maxDuration?: string;
  scanId?: string;
}

export interface BumblebeeScanProgress {
  packages: BumblebeePackage[];
  findings: BumblebeeFinding[];
}

export type ScanCallback = (progress: BumblebeeScanProgress) => void;

export interface BumblebeeClient {
  isAvailable(): Promise<{ available: boolean; version?: string; path?: string }>;
  scan(options: BumblebeeScanOptions, onProgress?: ScanCallback, signal?: AbortSignal): Promise<BumblebeeScanProgress>;
}

function findBinary(): string {
  return process.env.BUMBLEBEE_BIN || "bumblebee";
}

export function parseNdjsonLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function processRecord(
  record: Record<string, unknown>,
  scanId: string,
  packages: BumblebeePackage[],
  findings: BumblebeeFinding[],
): void {
  if (record.record_type === "package") {
    packages.push({
      id: (record.record_id as string) || randomUUID(),
      scanId,
      ecosystem: (record.ecosystem as string) || "unknown",
      packageName: (record.package_name as string) || "",
      normalizedName: (record.normalized_name as string) || (record.package_name as string) || "",
      version: (record.version as string) || "",
      projectPath: record.project_path as string | undefined,
      packageManager: record.package_manager as string | undefined,
      sourceType: (record.source_type as string) || "",
      sourceFile: (record.source_file as string) || "",
      confidence: (record.confidence as "high" | "medium" | "low") || "low",
    });
  } else if (record.record_type === "finding") {
    findings.push({
      id: (record.record_id as string) || randomUUID(),
      scanId,
      missionId: "",
      findingType: (record.finding_type as string) || "package_exposure",
      severity: (record.severity as "critical" | "high" | "medium" | "low") || "medium",
      catalogId: (record.catalog_id as string) || "",
      catalogName: (record.catalog_name as string) || "",
      ecosystem: (record.ecosystem as string) || "",
      packageName: (record.package_name as string) || "",
      normalizedName: (record.normalized_name as string) || (record.package_name as string) || "",
      version: (record.version as string) || "",
      sourceType: (record.source_type as string) || "",
      sourceFile: (record.source_file as string) || "",
      confidence: (record.confidence as "high" | "medium" | "low") || "low",
      evidence: (record.evidence as string) || "",
    });
  }
}

export function createBumblebeeClient(catalogLoader?: () => Promise<ExposureCatalog | null>): BumblebeeClient {
  let _nativeFallback = false;

  return {
    async isAvailable() {
      if (_nativeFallback) {
        return { available: true, version: "native-fallback", path: "builtin" };
      }
      const bin = findBinary();
      return new Promise((resolve) => {
        const proc = spawn(bin, ["version"], { stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
        proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
        proc.on("close", (code) => {
          if (code === 0) {
            const versionMatch = stdout.match(/v?\d+\.\d+\.\d+/);
            resolve({ available: true, version: versionMatch?.[0] ?? "unknown", path: bin });
          } else {
            // Binary exists but returned non-zero — still mark native fallback
            _nativeFallback = true;
            resolve({ available: true, version: "native-fallback", path: "builtin" });
          }
        });
        proc.on("error", (err: NodeJS.ErrnoException) => {
          // Binary not found (ENOENT) — switch to native JS scanner
          if (err.code === "ENOENT") {
            _nativeFallback = true;
            resolve({ available: true, version: "native-fallback", path: "builtin" });
          } else {
            resolve({ available: false });
          }
        });
      });
    },

    async scan(options, onProgress, signal) {
      // If we already know the binary is missing, go straight to native
      if (_nativeFallback) {
        const catalog = catalogLoader ? await catalogLoader().catch(() => null) : null;
        const result = await nativeScan(options.root, options.scanId || randomUUID(), catalog, options.ecosystems);
        onProgress?.(result);
        return result;
      }

      const bin = findBinary();
      const args = ["scan", "--profile", options.profile, "--root", options.root];

      if (options.ecosystems?.length) {
        for (const eco of options.ecosystems) {
          args.push("--ecosystem", eco);
        }
      }
      if (options.exposureCatalog) {
        args.push("--exposure-catalog", options.exposureCatalog);
      }
      if (options.maxDuration) {
        args.push("--max-duration", options.maxDuration);
      }

      return new Promise<BumblebeeScanProgress>((resolve, reject) => {
        const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
        const packages: BumblebeePackage[] = [];
        const findings: BumblebeeFinding[] = [];
        const scanId = options.scanId || randomUUID();
        let stderr = "";
        let buffer = "";

        proc.stdout.on("data", (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split("\n");
          // Keep the last (potentially partial) line in the buffer
          buffer = lines.pop()!;
          for (const line of lines) {
            const record = parseNdjsonLine(line);
            if (!record) continue;
            processRecord(record, scanId, packages, findings);

            onProgress?.({ packages: [...packages], findings: [...findings] });
          }
        });

        proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

        const abortHandler = () => {
          proc.kill("SIGTERM");
        };
        signal?.addEventListener("abort", abortHandler, { once: true });

        proc.on("close", (code) => {
          signal?.removeEventListener("abort", abortHandler);
          // Drain any remaining buffered line
          if (buffer.trim()) {
            const record = parseNdjsonLine(buffer);
            if (record) {
              processRecord(record, scanId, packages, findings);
              onProgress?.({ packages: [...packages], findings: [...findings] });
            }
          }
          if (code === 0 || (code !== null && packages.length > 0)) {
            resolve({ packages, findings });
          } else if (signal?.aborted) {
            reject(new Error("Scan aborted"));
          } else {
            reject(new Error(`bumblebee exited with code ${code}: ${stderr.trim()}`));
          }
        });

        proc.on("error", async (err: NodeJS.ErrnoException) => {
          signal?.removeEventListener("abort", abortHandler);
          // ENOENT = binary not found — fall back to native JS scanner
          if (err.code === "ENOENT") {
            _nativeFallback = true;
            try {
              const catalog = catalogLoader ? await catalogLoader().catch(() => null) : null;
              const result = await nativeScan(options.root, options.scanId || randomUUID(), catalog, options.ecosystems);
              onProgress?.(result);
              resolve(result);
            } catch (nativeErr) {
              reject(new Error(`Native fallback also failed: ${nativeErr instanceof Error ? nativeErr.message : String(nativeErr)}`));
            }
          } else {
            reject(new Error(`Failed to run bumblebee: ${err.message}`));
          }
        });
      });
    },
  };
}
