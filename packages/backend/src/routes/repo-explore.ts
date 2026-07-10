import { readFile, readdir, stat } from "fs/promises";
import { join, relative } from "path";
import { randomUUID } from "crypto";
import type { FastifyInstance } from "fastify";
import type { BumblebeeFinding, BumblebeeScanResult, BumblebeeScanSummary } from "@aurex/shared";
import type { LaPisClient } from "../clients/lapis-client.js";
import type { BumblebeeClient } from "../clients/bumblebee-client.js";
import { scanRepoForMutation } from "../scanner/mutation-scanner.js";

interface RepoExploreDeps {
  lapis: LaPisClient;
  bumblebeeClient?: BumblebeeClient;
}

interface RepoReadinessCommand {
  name: "install" | "test" | "typecheck" | "lint" | "build" | "dev" | "e2e";
  command: string;
  confidence: "high" | "medium" | "low";
  source: string;
  warning?: string;
}

interface RepoReadinessProfile {
  repoName: string;
  profile: string;
  packageManager: string | null;
  languages: string[];
  frameworks: string[];
  monorepo: boolean;
  lockfiles: string[];
  commands: RepoReadinessCommand[];
  blockers: string[];
  warnings: string[];
  confidence: "high" | "medium" | "low";
  generatedAt: string;
}

interface RepoPackageScanResponse {
  scan: BumblebeeScanResult;
  findings: BumblebeeFinding[];
  packageCount: number;
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(path, "utf-8"));
  } catch {
    return null;
  }
}

const MAX_READINESS_FILES = 2000;

async function listFiles(root: string, maxDepth = 3, maxFiles = MAX_READINESS_FILES): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, depth: number) {
    if (depth > maxDepth || out.length >= maxFiles) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= maxFiles) break;
      if (entry.name.startsWith(".git") || entry.name === "node_modules" || entry.name === "dist" || entry.name === "build") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, depth + 1);
      else if (entry.isFile()) out.push(relative(root, full));
    }
  }
  await walk(root, 0);
  return out;
}

function detectPackageManager(files: string[]): string | null {
  if (files.includes("pnpm-lock.yaml")) return "pnpm";
  if (files.includes("yarn.lock")) return "yarn";
  if (files.includes("package-lock.json")) return "npm";
  if (files.includes("bun.lockb") || files.includes("bun.lock")) return "bun";
  if (files.includes("Cargo.lock")) return "cargo";
  if (files.includes("poetry.lock")) return "poetry";
  if (files.includes("uv.lock")) return "uv";
  if (files.includes("go.sum")) return "go";
  return null;
}

function commandPrefix(manager: string | null): string {
  if (manager === "pnpm") return "pnpm";
  if (manager === "yarn") return "yarn";
  if (manager === "bun") return "bun";
  return "npm run";
}

function addPackageScriptCommands(commands: RepoReadinessCommand[], manager: string | null, scripts: Record<string, unknown>, source: string) {
  const prefix = commandPrefix(manager);
  const scriptMap: Array<[RepoReadinessCommand["name"], string[]]> = [
    ["test", ["test", "test:unit"]],
    ["typecheck", ["typecheck", "tsc"]],
    ["lint", ["lint"]],
    ["build", ["build"]],
    ["dev", ["dev", "start"]],
    ["e2e", ["test:e2e", "e2e"]],
  ];
  for (const [name, candidates] of scriptMap) {
    const script = candidates.find((s) => typeof scripts[s] === "string");
    if (!script) continue;
    commands.push({
      name,
      command: manager === "npm" || manager === null ? `npm run ${script}` : `${prefix} ${script}`,
      confidence: "high",
      source,
      warning: name === "e2e" ? "May require browsers, services, or Docker" : undefined,
    });
  }
}

export async function buildReadinessProfile(repoName: string, repoPath: string): Promise<RepoReadinessProfile> {
  const files = await listFiles(repoPath, 4);
  const fileSet = new Set(files);
  const rootPkg = await readJson(join(repoPath, "package.json"));
  const scripts = (rootPkg?.scripts && typeof rootPkg.scripts === "object" ? rootPkg.scripts : {}) as Record<string, unknown>;
  const deps = {
    ...((rootPkg?.dependencies && typeof rootPkg.dependencies === "object") ? rootPkg.dependencies as Record<string, unknown> : {}),
    ...((rootPkg?.devDependencies && typeof rootPkg.devDependencies === "object") ? rootPkg.devDependencies as Record<string, unknown> : {}),
  };
  const packageManager = detectPackageManager(files);
  const lockfiles = files.filter((f) => /(^|\/)(pnpm-lock\.yaml|yarn\.lock|package-lock\.json|bun\.lockb|bun\.lock|Cargo\.lock|poetry\.lock|uv\.lock|go\.sum)$/.test(f));
  const commands: RepoReadinessCommand[] = [];
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (rootPkg) {
    const install = packageManager === "pnpm" ? "pnpm install" : packageManager === "yarn" ? "yarn install" : packageManager === "bun" ? "bun install" : "npm install";
    commands.push({ name: "install", command: install, confidence: packageManager ? "high" : "medium", source: "package.json" });
    addPackageScriptCommands(commands, packageManager, scripts, "package.json");
    if (!lockfiles.some((f) => /pnpm-lock\.yaml|yarn\.lock|package-lock\.json|bun\.lockb|bun\.lock/.test(f))) {
      warnings.push("JavaScript package manifest found without a lockfile; dependency installs may be non-deterministic.");
    }
  }

  if (fileSet.has("Cargo.toml")) {
    commands.push({ name: "test", command: "cargo test", confidence: "high", source: "Cargo.toml" });
    commands.push({ name: "build", command: "cargo build", confidence: "high", source: "Cargo.toml" });
  }
  if (fileSet.has("go.mod")) {
    commands.push({ name: "test", command: "go test ./...", confidence: "high", source: "go.mod" });
    commands.push({ name: "build", command: "go build ./...", confidence: "medium", source: "go.mod" });
  }
  if (fileSet.has("pyproject.toml") || fileSet.has("pytest.ini")) {
    commands.push({ name: "test", command: "pytest", confidence: "medium", source: fileSet.has("pytest.ini") ? "pytest.ini" : "pyproject.toml" });
  }

  const languages = [
    files.some((f) => /\.(ts|tsx)$/.test(f)) && "TypeScript",
    files.some((f) => /\.(js|jsx|mjs|cjs)$/.test(f)) && "JavaScript",
    files.some((f) => /\.py$/.test(f)) && "Python",
    files.some((f) => /\.rs$/.test(f)) && "Rust",
    files.some((f) => /\.go$/.test(f)) && "Go",
  ].filter(Boolean) as string[];

  const frameworks = [
    ("react" in deps) && "React",
    ("next" in deps) && "Next.js",
    ("vite" in deps || fileSet.has("vite.config.ts") || fileSet.has("vite.config.js")) && "Vite",
    ("fastify" in deps) && "Fastify",
    ("express" in deps) && "Express",
    ("vitest" in deps || fileSet.has("vitest.config.ts")) && "Vitest",
  ].filter(Boolean) as string[];

  const monorepo = fileSet.has("pnpm-workspace.yaml") || fileSet.has("turbo.json") || fileSet.has("nx.json") || files.some((f) => /^packages\/[^/]+\/package\.json$/.test(f));
  const hasEnvExample = files.some((f) => /(^|\/)\.env(\.example|\.sample|\.template)$/.test(f));
  const hasEnvReference = files.some((f) => /(^|\/)\.env$/.test(f));
  if (hasEnvReference && !hasEnvExample) {
    warnings.push("Environment file detected without a matching .env.example/.env.sample template.");
  }
  if (!commands.some((c) => c.name === "test")) {
    blockers.push("No obvious test command was detected.");
  }
  if (rootPkg && !commands.some((c) => c.name === "build" || c.name === "typecheck")) {
    warnings.push("No obvious build or typecheck command was detected.");
  }
  if (files.some((f) => /^docker-compose/.test(f))) {
    warnings.push("Docker Compose files detected; some verification commands may require local services.");
  }

  const profile = [
    languages.includes("TypeScript") ? "TypeScript" : languages[0],
    monorepo ? "monorepo" : "project",
    frameworks[0],
  ].filter(Boolean).join(" ") || "Unknown project";

  return {
    repoName,
    profile,
    packageManager,
    languages,
    frameworks,
    monorepo,
    lockfiles,
    commands: dedupeCommands(commands),
    blockers,
    warnings,
    confidence: rootPkg || languages.length > 0 ? "medium" : "low",
    generatedAt: new Date().toISOString(),
  };
}

function dedupeCommands(commands: RepoReadinessCommand[]): RepoReadinessCommand[] {
  const seen = new Set<string>();
  const out: RepoReadinessCommand[] = [];
  for (const cmd of commands) {
    const key = `${cmd.name}:${cmd.command}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cmd);
  }
  return out;
}

function makeScanSummary(packages: Array<{ ecosystem: string }>, findings: BumblebeeFinding[]): BumblebeeScanSummary {
  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const finding of findings) severityCounts[finding.severity as keyof typeof severityCounts]++;
  return {
    totalPackages: packages.length,
    totalFindings: findings.length,
    criticalCount: severityCounts.critical,
    highCount: severityCounts.high,
    mediumCount: severityCounts.medium,
    lowCount: severityCounts.low,
    ecosystems: [...new Set(packages.map((p) => p.ecosystem))],
  };
}

async function resolveRepoPath(lapis: LaPisClient, repoName: string): Promise<string | null> {
  return lapis.getSetting<string>(`repo:${repoName}:path`);
}

// NOTE: This read-then-write is NOT atomic. Concurrent scans for the same repo
// could lose a scanId. Acceptable for single-user local dashboard use; add a
// mutex or atomic append if multi-user concurrency is needed.
async function appendToScanIndex(lapis: LaPisClient, repoName: string, scanId: string): Promise<void> {
  const index = await lapis.getSetting<{ scanIds: string[] }>(`repo:${repoName}:bumblebee_scans`);
  await lapis.setSetting(`repo:${repoName}:bumblebee_scans`, { scanIds: [...(index?.scanIds ?? []), scanId] });
}


export function registerRepoExploreRoutes(app: FastifyInstance, deps: RepoExploreDeps) {
  const { lapis, bumblebeeClient } = deps;

  app.post("/api/repos/:repoName/explore", async (request, reply) => {
    const { repoName } = request.params as { repoName: string };
    const repoPath = await resolveRepoPath(lapis, repoName);
    if (!repoPath) {
      return reply.status(404).send({ error: "Repository not found. Run prepare first." });
    }

    try {
      await lapis.indexRepo(repoPath, repoName);
      const summary = await lapis.getCodeSummary(repoName);
      const mutation = await scanRepoForMutation(repoPath);
      return { repoName, status: "completed" as const, summary, mutation };
    } catch (err) {
      const error = err instanceof Error ? err.message : "Indexing failed";
      const mutation = await scanRepoForMutation(repoPath);
      return { repoName, status: "failed" as const, error, mutation };
    }
  });

  app.get("/api/repos/:repoName/summary", async (request) => {
    const { repoName } = request.params as { repoName: string };
    return lapis.getCodeSummary(repoName);
  });

  app.get("/api/repos/:repoName/hotspots", async (request) => {
    const { repoName } = request.params as { repoName: string };
    return lapis.getCodeHotspots(repoName);
  });

  app.get("/api/repos/:repoName/readiness", async (request, reply) => {
    const { repoName } = request.params as { repoName: string };
    const repoPath = await resolveRepoPath(lapis, repoName);
    if (!repoPath || !await exists(repoPath)) {
      return reply.status(404).send({ error: "Repository not found. Run prepare first." });
    }
    const profile = await buildReadinessProfile(repoName, repoPath);
    await lapis.setSetting(`repo:${repoName}:readiness`, profile);
    return profile;
  });

  app.post("/api/repos/:repoName/scans", async (request, reply) => {
    const { repoName } = request.params as { repoName: string };
    const body = (request.body ?? {}) as { profile?: "baseline" | "project" | "deep"; ecosystems?: string[] };
    const repoPath = await resolveRepoPath(lapis, repoName);
    if (!repoPath || !await exists(repoPath)) {
      return reply.status(404).send({ error: "Repository not found. Run prepare first." });
    }
    if (!bumblebeeClient) {
      return reply.status(503).send({ error: "Package scanner is not configured." });
    }

    const startedAt = new Date().toISOString();
    try {
      const result = await bumblebeeClient.scan({
        root: repoPath,
        profile: body.profile ?? "project",
        ecosystems: body.ecosystems,
      });
      const scanId = result.packages[0]?.scanId ?? result.findings[0]?.scanId ?? randomUUID();
      const findings = result.findings.map((finding) => ({ ...finding, scanId, missionId: `repo:${repoName}` }));
      const scan: BumblebeeScanResult = {
        id: scanId,
        missionId: `repo:${repoName}`,
        profile: body.profile ?? "project",
        status: "completed",
        startedAt,
        completedAt: new Date().toISOString(),
        summary: makeScanSummary(result.packages, findings),
        findings,
      };
      await lapis.setSetting(`bumblebee_scan:${scan.id}`, scan);
      await appendToScanIndex(lapis, repoName, scan.id);
      return reply.code(201).send({ scan, findings, packageCount: result.packages.length } satisfies RepoPackageScanResponse);
    } catch (err) {
      const scan: BumblebeeScanResult = {
        id: randomUUID(),
        missionId: `repo:${repoName}`,
        profile: body.profile ?? "project",
        status: "failed",
        startedAt,
        completedAt: new Date().toISOString(),
      };
      await lapis.setSetting(`bumblebee_scan:${scan.id}`, scan);
      await appendToScanIndex(lapis, repoName, scan.id);
      return reply.code(500).send({ error: err instanceof Error ? err.message : "Package scan failed", scan });
    }
  });

  app.get("/api/repos/:repoName/scans", async (request) => {
    const { repoName } = request.params as { repoName: string };
    const index = await lapis.getSetting<{ scanIds: string[] }>(`repo:${repoName}:bumblebee_scans`);
    const scans: BumblebeeScanResult[] = [];
    for (const id of index?.scanIds ?? []) {
      const scan = await lapis.getSetting<BumblebeeScanResult>(`bumblebee_scan:${id}`);
      if (scan) scans.push(scan);
    }
    return { scans };
  });

  app.get("/api/repos/:repoName/scans/:scanId", async (request, reply) => {
    const { repoName, scanId } = request.params as { repoName: string; scanId: string };
    const scan = await lapis.getSetting<BumblebeeScanResult>(`bumblebee_scan:${scanId}`);
    if (!scan || scan.missionId !== `repo:${repoName}`) {
      return reply.status(404).send({ error: "Scan not found" });
    }
    return { scan, findings: scan.findings ?? [], packageCount: scan.summary?.totalPackages ?? 0 };
  });
}

export type {
  RepoReadinessProfile,
  RepoReadinessCommand,
  RepoPackageScanResponse,
};
