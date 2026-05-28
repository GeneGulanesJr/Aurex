// packages/backend/src/orchestrator/overlap.ts
import type { WorkingUnit } from "@aurex/shared";
import { minimatch } from "minimatch";
const GLOB_RE = /[*?[{]/;

function hasGlobChar(s: string): boolean {
  return GLOB_RE.test(s);
}

function hasAnyGlobs(paths: string[]): boolean {
  for (let i = 0; i < paths.length; i++) {
    if (GLOB_RE.test(paths[i])) return true;
  }
  return false;
}

function exactPathOverlap(a: string[], b: string[]): boolean {
  const set = new Set(a);
  for (let i = 0; i < b.length; i++) {
    if (set.has(b[i])) return true;
  }
  return false;
}

function globPathOverlap(newPaths: string[], existingPaths: string[]): boolean {
  return newPaths.some((newPath) =>
    existingPaths.some((existingPath) =>
      minimatch(newPath, existingPath) || minimatch(existingPath, newPath),
    ),
  );
}

function checkPathOverlap(newPaths: string[], existingPaths: string[]): boolean {
  if (!hasAnyGlobs(newPaths) && !hasAnyGlobs(existingPaths)) {
    return exactPathOverlap(newPaths, existingPaths);
  }
  return globPathOverlap(newPaths, existingPaths);
}

interface ScopeDeclaration {
  declaredPaths: string[];
  declaredModules: string[];
}

export interface OverlapResult {
  overlap: boolean;
  overlappingUnits: string[];
}

/**
 * Pre-spawn scope check: uses declared_paths + declared_modules only.
 * Git diff doesn't exist yet — the task branch hasn't been written to.
 */
export function checkPreSpawnOverlap(
  newScope: ScopeDeclaration,
  existingUnits: WorkingUnit[],
): OverlapResult {
  const newPaths = newScope.declaredPaths;
  const newModules = newScope.declaredModules;
  const newModulesSet = new Set(newModules);

  const overlapping: string[] = [];

  for (const unit of existingUnits) {
    if (unit.status !== "working" && unit.status !== "spawned") continue;

    const moduleOverlap = unit.declaredModules.some((m) => newModulesSet.has(m));
    if (moduleOverlap) {
      overlapping.push(unit.id);
      continue;
    }

    if (checkPathOverlap(newPaths, unit.declaredPaths)) {
      overlapping.push(unit.id);
    }
  }

  return { overlap: overlapping.length > 0, overlappingUnits: overlapping };
}

/**
 * Post-commit scope: unions declared scope with actual git diff files.
 */
export function computePostCommitScope(
  declaredScope: ScopeDeclaration,
  gitDiffFiles: string[],
): string[] {
  const declared = new Set(declaredScope.declaredPaths);
  for (const file of gitDiffFiles) {
    declared.add(file);
  }
  return Array.from(declared);
}

/**
 * Detect if a set of file paths overlaps with any existing working unit's scope.
 */
export function detectOverlap(
  filePaths: string[],
  existingUnits: WorkingUnit[],
): OverlapResult {
  const overlapping: string[] = [];
  const filePathsAreConcrete = !hasAnyGlobs(filePaths);
  const filePathsSet = filePathsAreConcrete ? new Set(filePaths) : null;

  for (const unit of existingUnits) {
    if (unit.status !== "working" && unit.status !== "spawned") continue;

    const unitPathsAreConcrete = !hasAnyGlobs(unit.declaredPaths);
    let hasOverlap: boolean;
    if (filePathsAreConcrete && unitPathsAreConcrete && filePathsSet) {
      hasOverlap = unit.declaredPaths.some((p) => filePathsSet.has(p));
    } else {
      hasOverlap = filePaths.some((file) =>
        unit.declaredPaths.some((pattern) => minimatch(file, pattern)),
      );
    }

    if (hasOverlap) {
      overlapping.push(unit.id);
    }
  }

  return { overlap: overlapping.length > 0, overlappingUnits: overlapping };
}
