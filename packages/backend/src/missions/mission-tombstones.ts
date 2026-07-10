import type { LaPisClient } from "../clients/lapis-client.js";

const DELETED_MISSIONS_KEY = "aurex:deleted_missions";

interface DeletedMissionsSetting {
  ids: string[];
}

export async function getDeletedMissionIds(lapis: LaPisClient): Promise<Set<string>> {
  const stored = await lapis.getSetting<DeletedMissionsSetting>(DELETED_MISSIONS_KEY);
  return new Set(stored?.ids ?? []);
}

export async function isMissionDeleted(lapis: LaPisClient, missionId: string): Promise<boolean> {
  const deleted = await getDeletedMissionIds(lapis);
  return deleted.has(missionId);
}

export async function tombstoneMission(lapis: LaPisClient, missionId: string): Promise<void> {
  const deleted = await getDeletedMissionIds(lapis);
  if (deleted.has(missionId)) return;
  deleted.add(missionId);
  await lapis.setSetting(DELETED_MISSIONS_KEY, { ids: [...deleted] });
}

export function filterDeletedMissions<T extends { missionId: string }>(
  missions: T[],
  deleted: Set<string>,
): T[] {
  return missions.filter((mission) => !deleted.has(mission.missionId));
}
