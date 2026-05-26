// packages/backend/src/enforcement/contract-immutability.ts

interface ExistingContract {
  id: string;
  version: number;
  supersededBy: string | null;
  supersedes: string | null;
  rescopeEventId: string | null;
}

interface TransitionResult {
  valid: boolean;
  reason?: string;
}

export function validateContractAppend(
  existing: ExistingContract[],
  _newContract: { milestoneId: string; content: unknown },
): TransitionResult {
  if (existing.length === 0) {
    return { valid: true };
  }

  const latest = existing.reduce((a, b) => (a.version > b.version ? a : b));

  if (latest.supersededBy === null) {
    return {
      valid: false,
      reason: `Cannot append contract: current contract ${latest.id} (v${latest.version}) is not superseded. Supersede it first.`,
    };
  }

  return { valid: true };
}

export function validateSupersede(
  oldContractId: string,
  supersedeInfo: { rescopeEventId: string | null },
): TransitionResult {
  if (!supersedeInfo.rescopeEventId) {
    return {
      valid: false,
      reason: `Cannot supersede contract ${oldContractId}: rescope event is mandatory when superseding contracts.`,
    };
  }
  return { valid: true };
}
