import type { Mission, Milestone, WorkingUnit } from "@aurex/shared";

export function selectWorkerTimeout(
  unit: WorkingUnit,
  workerTimeouts: Mission["configJson"]["workerTimeouts"],
): number {
  const timeouts = workerTimeouts ?? { simple: 300_000, build: 600_000, testHeavy: 600_000 };
  const text = [unit.description, ...unit.declaredModules, ...unit.declaredPaths]
    .join(" ")
    .toLowerCase();

  if (/\b(test|vitest|jest|playwright|cypress|pytest|cargo test|go test|e2e|integration)\b/.test(text)) {
    return timeouts.testHeavy;
  }

  if (/\b(build|compile|bundle|install|migration|codegen|generate|docker)\b/.test(text)) {
    return timeouts.build;
  }

  if (/\b(analy[sz]e|inventory|measure|audit|research|map|hotspot|complexity)\b/.test(text)) {
    return timeouts.testHeavy;
  }

  return timeouts.simple;
}

export function selectWorkerMaxTimeout(timeout: number): number {
  return Math.max(timeout * 4, timeout + 10 * 60_000);
}

export function applyWorkingUnitScopeFallback(
  unit: WorkingUnit,
  mission: Mission,
  milestone: Milestone,
  repoRoot: string,
): WorkingUnit {
  if (unit.declaredPaths.length > 0 && unit.declaredModules.length > 0) {
    return unit;
  }

  const inferredPaths = unit.declaredPaths.length > 0
    ? unit.declaredPaths
    : inferDeclaredPathsFromText([
        mission.description,
        milestone.title,
        milestone.description,
        unit.description,
      ], repoRoot);
  const inferredModules = unit.declaredModules.length > 0
    ? unit.declaredModules
    : inferModulesFromPaths(inferredPaths);

  if (inferredPaths.length === unit.declaredPaths.length && inferredModules.length === unit.declaredModules.length) {
    return unit;
  }

  if (inferredPaths.length === 0 && inferredModules.length === 0) {
    return unit;
  }

  return {
    ...unit,
    declaredPaths: inferredPaths,
    declaredModules: inferredModules,
  };
}

export function applyWorkingUnitDescriptionFallback(
  unit: WorkingUnit,
  mission: Mission,
  milestone: Milestone,
): WorkingUnit {
  if (unit.description.trim().length > 0) {
    return unit;
  }

  const description = [
    milestone.description,
    milestone.title,
    mission.description,
  ].find((text) => text.trim().length > 0)?.trim() ?? "Complete assigned working unit";

  return {
    ...unit,
    description,
  };
}

export function enrichWorkingUnitsForExecution(
  units: WorkingUnit[],
  mission: Mission,
  milestone: Milestone,
  repoRoot: string,
): WorkingUnit[] {
  return units
    .map((unit) => applyWorkingUnitScopeFallback(unit, mission, milestone, repoRoot))
    .map((unit) => applyWorkingUnitDescriptionFallback(unit, mission, milestone))
    .filter((unit) => unit.status !== "superseded");
}

export function mergeRuntimeUnitFields(
  unit: WorkingUnit,
  runtime?: Pick<WorkingUnit, "taskBranch" | "worktreePath" | "sessionId">,
): WorkingUnit {
  if (!runtime) return unit;
  return {
    ...unit,
    taskBranch: unit.taskBranch || runtime.taskBranch,
    worktreePath: unit.worktreePath || runtime.worktreePath,
    sessionId: unit.sessionId || runtime.sessionId,
  };
}

function inferDeclaredPathsFromText(textParts: string[], repoRoot: string): string[] {
  const text = textParts.filter(Boolean).join(" ");
  const paths = new Set<string>();
  const normalizedRoot = repoRoot.replace(/\/+$/, "");

  if (normalizedRoot.length > 0) {
    const absolutePathPattern = new RegExp(`${escapeRegex(normalizedRoot)}/([^\\s\`"'<>\\)\\]\\}]+)`, "g");
    for (const match of text.matchAll(absolutePathPattern)) {
      addPath(paths, match[1]);
    }
  }

  if (paths.size === 0) {
    const relativePathPattern = /(?:^|[\s`"'(])([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+\.(?:rs|ts|tsx|js|jsx|mjs|cjs|py|go|java|kt|swift|rb|php|cs|cpp|c|h|hpp|md|toml|json|ya?ml|css|scss|html|sql))/g;
    for (const match of text.matchAll(relativePathPattern)) {
      addPath(paths, match[1]);
    }
  }

  return [...paths];
}

function inferModulesFromPaths(paths: string[]): string[] {
  const modules = new Set<string>();
  for (const filePath of paths) {
    const parts = filePath.split("/").filter(Boolean);
    const srcIndex = parts.lastIndexOf("src");
    if (srcIndex >= 0 && parts[srcIndex + 1]) {
      // The segment directly under src is normally the module name
      // (e.g. `src/auth/login.ts` → "auth", `src/auth/mod.rs` → "auth").
      // The one exception is the Rust crate-root `src/mod.rs`, whose only
      // segment is "mod.rs" itself — there is no module name to extract, so
      // skip it rather than emit the meaningless "mod". (Previously this fell
      // through to `.replace()` on "mod.rs", yielding "mod" for every crate
      // root — and the dead `parts[srcIndex - 1]` branch never fired because
      // `srcIndex` is 0 there, making `parts[-1]` undefined.)
      if (parts[srcIndex + 1] === "mod.rs" && parts[srcIndex + 2] === undefined) {
        continue;
      }
      modules.add(parts[srcIndex + 1].replace(/\.[^.]+$/, ""));
      continue;
    }
    if (parts.length > 1) {
      modules.add(parts[parts.length - 2]);
    }
  }
  return [...modules];
}

function addPath(paths: Set<string>, candidate: string | undefined): void {
  const cleaned = candidate
    ?.trim()
    .replace(/[.,;:!?]+$/, "")
    .replace(/^\/+/, "");
  if (cleaned && cleaned.includes("/") && !cleaned.includes("..")) {
    paths.add(cleaned);
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
