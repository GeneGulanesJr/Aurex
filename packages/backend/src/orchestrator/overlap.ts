import type { WorkingUnit, SerializationMap, WorkingUnitBatch } from '@aurex/shared';

export function computeOverlap(workingUnits: WorkingUnit[]): SerializationMap {
  if (workingUnits.length === 0) {
    return { batches: [] };
  }

  const filePaths = new Map<string, string[]>();
  const modules = new Map<string, string[]>();

  for (const unit of workingUnits) {
    const files: string[] = JSON.parse(unit.filePathsJson || '[]');
    const mods: string[] = JSON.parse(unit.modulesJson || '[]');
    filePaths.set(unit.id, files);
    modules.set(unit.id, mods);
  }

  const conflictGraph = new Map<string, Set<string>>();
  for (const unit of workingUnits) {
    conflictGraph.set(unit.id, new Set());
  }

  for (let i = 0; i < workingUnits.length; i++) {
    for (let j = i + 1; j < workingUnits.length; j++) {
      const a = workingUnits[i];
      const b = workingUnits[j];
      const aFiles = filePaths.get(a.id) || [];
      const bFiles = filePaths.get(b.id) || [];
      const aMods = modules.get(a.id) || [];
      const bMods = modules.get(b.id) || [];

      const hasOverlap =
        aFiles.some(f => bFiles.includes(f)) ||
        aMods.some(m => bMods.includes(m));

      if (hasOverlap) {
        conflictGraph.get(a.id)!.add(b.id);
        conflictGraph.get(b.id)!.add(a.id);
      }
    }
  }

  const batches: WorkingUnitBatch[] = [];
  const assigned = new Set<string>();

  while (assigned.size < workingUnits.length) {
    const batchUnits: string[] = [];
    const batchConflicts = new Set<string>();

    for (const unit of workingUnits) {
      if (assigned.has(unit.id)) continue;
      if (batchConflicts.has(unit.id)) continue;

      batchUnits.push(unit.id);
      assigned.add(unit.id);

      const conflicts = conflictGraph.get(unit.id);
      if (conflicts) {
        for (const c of conflicts) {
          batchConflicts.add(c);
        }
      }
    }

    const dependsOn = batches.length > 0 ? [batches.length - 1] : [];

    batches.push({
      batchIndex: batches.length,
      unitIds: batchUnits,
      dependsOnBatches: dependsOn,
    });
  }

  return { batches };
}
