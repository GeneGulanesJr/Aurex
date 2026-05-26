// packages/backend/src/orchestrator/overlap.ts
import type { WorkingUnit } from "@aurex/shared";
import { minimatch } from "minimatch";

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

  const overlapping: string[] = [];

  for (const unit of existingUnits) {
    if (unit.status !== "working" && unit.status !== "spawned") continue;

    // Check module overlap
    const moduleOverlap = newModules.some((m) => unit.declaredModules.includes(m));
    if (moduleOverlap) {
      overlapping.push(unit.id);
      continue;
    }

    // Check path overlap using glob matching
    const pathOverlap = newPaths.some((newPath) =>
      unit.declaredPaths.some((existingPath) =>
        minimatch(newPath, existingPath) || minimatch(existingPath, newPath),
      ),
    );
    if (pathOverlap) {
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

  for (const unit of existingUnits) {
    if (unit.status !== "working" && unit.status !== "spawned") continue;

    const hasOverlap = filePaths.some((file) =>
      unit.declaredPaths.some((pattern) => minimatch(file, pattern)),
    );

    if (hasOverlap) {
      overlapping.push(unit.id);
    }
  }

  return { overlap: overlapping.length > 0, overlappingUnits: overlapping };
}
