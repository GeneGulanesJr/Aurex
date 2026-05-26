import type {
  CreateMissionResponse,
  GetMissionResponse,
  ListMissionsResponse,
  CheckpointResponse,
} from '@aurex/shared';

const API_BASE = '/api';

async function parseResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json() as Record<string, unknown>;
      if (typeof body.error === 'string') message = body.error;
    } catch {
      // use default message
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export async function createMission(description: string): Promise<CreateMissionResponse> {
  const res = await fetch(`${API_BASE}/missions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description }),
  });
  return parseResponse<CreateMissionResponse>(res);
}

export async function getMission(id: string): Promise<GetMissionResponse> {
  const res = await fetch(`${API_BASE}/missions/${id}`);
  return parseResponse<GetMissionResponse>(res);
}

export async function listMissions(status?: string): Promise<ListMissionsResponse> {
  const params = status ? `?status=${encodeURIComponent(status)}` : '';
  const res = await fetch(`${API_BASE}/missions${params}`);
  return parseResponse<ListMissionsResponse>(res);
}

export async function submitCheckpoint(
  missionId: string,
  decision: 'approve' | 'reject' | 'override',
  overrideReason?: string,
): Promise<CheckpointResponse> {
  const res = await fetch(`${API_BASE}/missions/${missionId}/checkpoint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision, overrideReason }),
  });
  return parseResponse<CheckpointResponse>(res);
}
