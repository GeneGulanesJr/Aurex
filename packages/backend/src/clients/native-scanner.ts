/**
 * Pure-JS supply-chain scanner — used as fallback when the `bumblebee` CLI
 * binary is not installed. Walks the repo tree, reads package manifests
 * (package.json, package-lock.json, yarn.lock), and matches dependencies
 * against the exposure catalog.
 */
import { readFile, readdir } from "fs/promises";
import { join, relative } from "path";
import { randomUUID } from "crypto";
import type { BumblebeePackage, BumblebeeFinding } from "@aurex/shared";
import type { ExposureCatalog } from "@aurex/shared";

interface ManifestDependency {
  version: string;
  resolved?: string;
  dev?: boolean;
}

interface NativeScanResult {
  packages: BumblebeePackage[];
  findings: BumblebeeFinding[];
}

/**
 * Recursively walk a directory and return all file paths matching a predicate.
 */
async function walkDir(root: string, predicate: (name: string) => boolean, maxDepth = 8): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist" || entry.name === "build") {
        continue;
      }
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath, depth + 1);
      } else if (entry.isFile() && predicate(entry.name)) {
        results.push(fullPath);
      }
    }
  }

  await walk(root, 0);
  return results;
}

/**
 * Parse a yarn.lock file (simplified — extracts package name@version pairs).
 */
function parseYarnLock(content: string): Map<string, string> {
  const deps = new Map<string, string>();
  const lines = content.split("\n");
  for (const line of lines) {
    const match = line.match(/^"?(@?[^@ "\n]+)@[^:]*:\s*$/);
    if (match) {
      const pkgName = match[1];
      // Next non-empty line should have "version"
      const idx = lines.indexOf(line);
      for (let i = idx + 1; i < Math.min(idx + 5, lines.length); i++) {
        const vMatch = lines[i].match(/\s+version\s+"([^"]+)"/);
        if (vMatch) {
          deps.set(pkgName, vMatch[1]);
          break;
        }
      }
    }
  }
  return deps;
}

/**
 * Read all dependency manifests in the repo and extract packages.
 */
async function collectPackages(
  root: string,
  scanId: string,
): Promise<{ packages: BumblebeePackage[]; lockfiles: string[] }> {
  const packages: BumblebeePackage[] = [];
  const lockfiles: string[] = [];

  // Find all package.json files
  const manifests = await walkDir(root, (n) => n === "package.json");

  for (const manifestPath of manifests) {
    let raw: string;
    try {
      raw = await readFile(manifestPath, "utf-8");
    } catch {
      continue;
    }

    let pkg: Record<string, unknown>;
    try {
      pkg = JSON.parse(raw);
    } catch {
      continue;
    }

    const relPath = relative(root, manifestPath);
    const depSections = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;

    for (const section of depSections) {
      const deps = pkg[section] as Record<string, string> | undefined;
      if (!deps) continue;

      for (const [name, version] of Object.entries(deps)) {
        // Skip workspace protocol and file: references
        if (version.startsWith("workspace:") || version.startsWith("file:")) continue;
        // Clean version string
        const cleanVersion = version.replace(/^[\^~>=<]+/, "").split(" ").pop() || version;

        packages.push({
          id: randomUUID(),
          scanId,
          ecosystem: "npm",
          packageName: name,
          normalizedName: name.replace(/^@[^/]+\//, ""),
          version: cleanVersion,
          projectPath: relPath,
          packageManager: "npm",
          sourceType: section === "devDependencies" ? "dev" : "prod",
          sourceFile: relPath,
          confidence: "high",
        });
      }
    }
  }

  // Find lockfiles for ecosystem detection
  const lockMatches = await walkDir(root, (n) =>
    n === "package-lock.json" || n === "yarn.lock" || n === "pnpm-lock.yaml",
  );
  lockfiles.push(...lockMatches);

  // Read package-lock.json for resolved versions if available
  for (const lockPath of lockMatches) {
    if (!lockPath.endsWith("package-lock.json")) continue;
    try {
      const raw = await readFile(lockPath, "utf-8");
      const lock = JSON.parse(raw);
      const lockDeps = lock.dependencies as Record<string, ManifestDependency> | undefined;
      if (!lockDeps) continue;

      const relLock = relative(root, lockPath);
      for (const [name, info] of Object.entries(lockDeps)) {
        // Upgrade existing package entry to exact resolved version if found
        const existing = packages.find(
          (p) => p.packageName === name && p.sourceFile === relLock.replace("/package-lock.json", "/package.json"),
        );
        if (existing && info.version) {
          existing.version = info.version;
        }
      }
    } catch {
      // Lock parse failure — estimates are fine
    }
  }

  // Read yarn.lock if present
  for (const lockPath of lockMatches) {
    if (!lockPath.endsWith("yarn.lock")) continue;
    try {
      const raw = await readFile(lockPath, "utf-8");
      const yarnDeps = parseYarnLock(raw);
      for (const [name, version] of yarnDeps) {
        const existing = packages.find((p) => p.packageName === name);
        if (existing) {
          existing.version = version;
        }
      }
    } catch {
      // Yarn lock parse failure — fine
    }
  }

  return { packages, lockfiles };
}

/**
 * Match packages against the exposure catalog to produce findings.
 */
function matchCatalog(
  packages: BumblebeePackage[],
  catalog: ExposureCatalog | null,
  scanId: string,
): BumblebeeFinding[] {
  if (!catalog?.entries?.length) return [];

  const findings: BumblebeeFinding[] = [];

  for (const entry of catalog.entries) {
    // Match by package name (exact or scoped)
    const matching = packages.filter(
      (p) => p.packageName === entry.package || p.normalizedName === entry.package,
    );
    for (const pkg of matching) {
      // Check if version is in the affected range
      const versionMatches = entry.versions.length === 0 || entry.versions.some((v) => {
        if (v === "*" || v === "all") return true;
        return pkg.version.startsWith(v.replace(/^[\^~]/, ""));
      });

      if (versionMatches) {
        findings.push({
          id: randomUUID(),
          scanId,
          missionId: "",
          findingType: "package_exposure",
          severity: entry.severity,
          catalogId: entry.id,
          catalogName: entry.name,
          ecosystem: pkg.ecosystem,
          packageName: pkg.packageName,
          normalizedName: pkg.normalizedName,
          version: pkg.version,
          sourceType: pkg.sourceType,
          sourceFile: pkg.sourceFile,
          confidence: "high",
          evidence: `Package ${pkg.packageName}@${pkg.version} matches catalog entry "${entry.name}" (${entry.severity})`,
        });
      }
    }
  }

  return findings;
}

/**
 * Heuristic checks — flag common risky patterns even without a catalog.
 */
function heuristicFindings(
  packages: BumblebeePackage[],
  scanId: string,
): BumblebeeFinding[] {
  const findings: BumblebeeFinding[] = [];

  // Known risky packages
  const riskyPackages = new Map([
    ["event-stream", "high"],
    ["flatmap-stream", "critical"],
    ["lodash", "medium"],
    ["underscore", "low"],
    ["moment", "low"],
    ["request", "medium"],
    ["node-uuid", "medium"],
    ["left-pad", "low"],
  ]);

  for (const pkg of packages) {
    const risk = riskyPackages.get(pkg.packageName);
    if (risk) {
      findings.push({
        id: randomUUID(),
        scanId,
        missionId: "",
        findingType: "package_exposure",
        severity: risk as "critical" | "high" | "medium" | "low",
        catalogId: `heuristic-${pkg.packageName}`,
        catalogName: `Known risky package: ${pkg.packageName}`,
        ecosystem: pkg.ecosystem,
        packageName: pkg.packageName,
        normalizedName: pkg.normalizedName,
        version: pkg.version,
        sourceType: pkg.sourceType,
        sourceFile: pkg.sourceFile,
        confidence: "medium",
        evidence: `${pkg.packageName}@${pkg.version} is a known risk indicator`,
      });
    }
  }

  return findings;
}

/**
 * Main entry point — scans a repo directory for supply-chain findings.
 */
export async function nativeScan(
  root: string,
  scanId: string,
  catalog: ExposureCatalog | null,
  ecosystems?: string[],
): Promise<NativeScanResult> {
  const { packages: allPackages } = await collectPackages(root, scanId);

  // Filter by ecosystem if specified
  const packages = ecosystems?.length
    ? allPackages.filter((p) => ecosystems.includes(p.ecosystem))
    : allPackages;

  // Deduplicate by packageName@version
  const seen = new Set<string>();
  const unique: BumblebeePackage[] = [];
  for (const pkg of packages) {
    const key = `${pkg.packageName}@${pkg.version}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(pkg);
    }
  }

  // Generate findings
  const catalogFindings = matchCatalog(unique, catalog, scanId);
  const heuristicResults = heuristicFindings(unique, scanId);

  // Merge findings, deduplicate
  const findingIds = new Set<string>();
  const findings: BumblebeeFinding[] = [];
  for (const f of [...catalogFindings, ...heuristicResults]) {
    const key = `${f.packageName}:${f.catalogId}`;
    if (!findingIds.has(key)) {
      findingIds.add(key);
      findings.push(f);
    }
  }

  return { packages: unique, findings };
}
