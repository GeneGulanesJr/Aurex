const API_BASE = '/api';

export async function createMission(description: string) {
  const res = await fetch(`${API_BASE}/missions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error((err as { error: string }).error);
  }
  return res.json();
}

export async function getMission(id: string) {
  const res = await fetch(`${API_BASE}/missions/${id}`);
  if (!res.ok) throw new Error('Mission not found');
  return res.json();
}

export async function listMissions(status?: string) {
  const params = status ? `?status=${status}` : '';
  const res = await fetch(`${API_BASE}/missions${params}`);
  if (!res.ok) throw new Error('Failed to list missions');
  return res.json();
}

export async function submitCheckpoint(
  missionId: string,
  decision: 'approve' | 'reject' | 'override',
  overrideReason?: string,
) {
  const res = await fetch(`${API_BASE}/missions/${missionId}/checkpoint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision, overrideReason }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error((err as { error: string }).error);
  }
  return res.json();
}
