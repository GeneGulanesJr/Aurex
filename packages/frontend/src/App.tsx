import { useState, useEffect, useCallback, useRef } from 'react';
import type { WsEvent, CheckpointRequiredData, GetMissionResponse, ListMissionsResponse, ValidationContract, MissionListItem, MilestoneSummary, ActiveWorker, BroadcastSummary } from '@aurex/shared';
import { createMission, getMission, listMissions, submitCheckpoint } from './api.js';
import { MissionWebSocket } from './websocket.js';
import './styles.css';

export function App() {
  const [view, setView] = useState<'list' | 'mission'>('list');
  const [missionId, setMissionId] = useState<string | null>(null);
  const [missions, setMissions] = useState<MissionListItem[]>([]);
  const [missionDesc, setMissionDesc] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const loadMissions = useCallback(async () => {
    try {
      const data = await listMissions();
      setMissions(data.missions);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load missions');
    }
  }, []);

  useEffect(() => {
    loadMissions();
  }, [loadMissions]);

  const handleCreate = async () => {
    if (!missionDesc.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const result = await createMission(missionDesc.trim());
      setMissionId(result.missionId);
      setView('mission');
      setMissionDesc('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create mission');
    } finally {
      setCreating(false);
    }
  };

  const handleSelectMission = useCallback((id: string) => {
    setMissionId(id);
    setView('mission');
    setError(null);
  }, []);

  const handleBack = useCallback(() => {
    setMissionId(null);
    setView('list');
    setError(null);
    loadMissions();
  }, [loadMissions]);

  return (
    <div className="app">
      <div className="header">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {view === 'mission' && (
            <button className="back-btn" onClick={handleBack}>Back</button>
          )}
          <h1>AUREX</h1>
        </div>
        {missionId && view === 'mission' && (
          <span className="mission-id">{missionId}</span>
        )}
      </div>

      {error && <div className="error-msg">{error}</div>}

      {view === 'list' ? (
        <MissionList
          missions={missions}
          missionDesc={missionDesc}
          setMissionDesc={setMissionDesc}
          onCreate={handleCreate}
          creating={creating}
          onSelect={handleSelectMission}
        />
      ) : missionId ? (
        <MissionView missionId={missionId} />
      ) : null}
    </div>
  );
}

function MissionList({
  missions,
  missionDesc,
  setMissionDesc,
  onCreate,
  creating,
  onSelect,
}: {
  missions: ListMissionsResponse['missions'];
  missionDesc: string;
  setMissionDesc: (v: string) => void;
  onCreate: () => void;
  creating: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      <div className="create-form">
        <input
          type="text"
          placeholder="Describe the mission..."
          value={missionDesc}
          onChange={(e) => setMissionDesc(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !creating && onCreate()}
          disabled={creating}
        />
        <button className="btn approve" onClick={onCreate} disabled={creating || !missionDesc.trim()}>
          {creating ? 'Planning...' : 'Start Mission'}
        </button>
      </div>
      <div className="panel" style={{ flex: 1 }}>
        <div className="panel-header">Missions</div>
        <div className="panel-body">
          {missions.length === 0 ? (
            <div className="empty-state">No missions yet</div>
          ) : (
            <ul className="mission-list">
              {missions.map((m: MissionListItem) => (
                <li key={m.id} onClick={() => onSelect(m.id)}>
                  <span className="desc">{m.description}</span>
                  <span className={`status-badge ${m.status}`}>{m.status}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}

function MissionView({ missionId }: { missionId: string }) {
  const [mission, setMission] = useState<GetMissionResponse | null>(null);
  const [checkpoint, setCheckpoint] = useState<CheckpointRequiredData | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const wsRef = useRef<MissionWebSocket | null>(null);

  const refreshMission = useCallback(async () => {
    try {
      const data = await getMission(missionId);
      setMission(data);
    } catch {
      // mission may not exist yet
    }
  }, [missionId]);

  useEffect(() => {
    refreshMission();

    const ws = new MissionWebSocket(missionId);
    wsRef.current = ws;

    ws.subscribe((event: WsEvent) => {
      if (event.type === 'checkpoint_required') {
        setCheckpoint(event.data as CheckpointRequiredData);
      } else {
        refreshMission();
      }
    });

    ws.connect();

    const interval = setInterval(refreshMission, 5000);

    return () => {
      ws.disconnect();
      wsRef.current = null;
      clearInterval(interval);
    };
  }, [missionId, refreshMission]);

  const handleCheckpoint = async (decision: 'approve' | 'reject' | 'override') => {
    try {
      await submitCheckpoint(
        missionId,
        decision,
        decision === 'override' ? overrideReason : undefined,
      );
      setCheckpoint(null);
      setOverrideReason('');
      refreshMission();
    } catch (e) {
      console.error('Checkpoint submission failed:', e);
    }
  };

  if (!mission) {
    return <div className="empty-state">Loading mission...</div>;
  }

  return (
    <>
      <div className="grid">
        <div className="panel full-width">
          <div className="panel-header">Milestones</div>
          <div className="milestone-bar">
            {mission.milestones.map((m: MilestoneSummary) => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <span className={`milestone-dot ${m.status}`} />
                <span className="milestone-label">{m.title}</span>
              </div>
            ))}
            <span className={`status-badge ${mission.status}`} style={{ marginLeft: 'auto' }}>
              {mission.status}
            </span>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">Active Workers</div>
          <div className="panel-body">
            {mission.activeWorkers.length === 0 ? (
              <div className="empty-state">No active workers</div>
            ) : (
              mission.activeWorkers.map((w: ActiveWorker) => (
                <div key={w.id} className="worker-card">
                  <div className="title">{w.title}</div>
                  <div className="meta">
                    <span className={`status-badge ${w.status}`}>{w.status}</span>
                    {' '}{Math.round(w.elapsedMs / 1000)}s
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">Cost & Stats</div>
          <div className="panel-body">
            <div className="cost-counter">
              <div>Total: <span className="amount">${mission.costTotal.toFixed(4)}</span></div>
              <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                Retries: {mission.retryCount} | Rescopes: {mission.rescopeCount}
              </div>
            </div>
          </div>
        </div>

        <div className="panel full-width">
          <div className="panel-header">Broadcasts</div>
          <div className="panel-body">
            {mission.recentBroadcasts.length === 0 ? (
              <div className="empty-state">No broadcasts yet</div>
            ) : (
              mission.recentBroadcasts.map((b: BroadcastSummary) => (
                <div key={b.id} className="broadcast-item">
                  <div>
                    <span className={`category ${b.category}`}>{b.category}</span>
                    <span className="time">{new Date(b.createdAt).toLocaleTimeString()}</span>
                  </div>
                  <div className="content">{b.content}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {checkpoint && (
        <CheckpointOverlay
          checkpoint={checkpoint}
          overrideReason={overrideReason}
          setOverrideReason={setOverrideReason}
          onAction={handleCheckpoint}
        />
      )}
    </>
  );
}

function CheckpointOverlay({
  checkpoint,
  overrideReason,
  setOverrideReason,
  onAction,
}: {
  checkpoint: CheckpointRequiredData;
  overrideReason: string;
  setOverrideReason: (v: string) => void;
  onAction: (decision: 'approve' | 'reject' | 'override') => void;
}) {
  const [showOverride, setShowOverride] = useState(false);

  const contextText = [
    `Trigger: ${checkpoint.trigger}`,
    `Milestone: ${checkpoint.milestoneTitle}`,
    '',
    'Validation Contracts:',
    ...checkpoint.validationContracts.map((c: ValidationContract, i: number) => `  ${i + 1}. ${c.description}`),
    '',
    `Retries: ${checkpoint.retryCount} | Rescopes: ${checkpoint.rescopeCount}`,
  ].join('\n');

  return (
    <div className="checkpoint-overlay">
      <div className="checkpoint-panel">
        <h2>Checkpoint Required</h2>
        <pre className="context">{contextText}</pre>

        {showOverride && (
          <textarea
            className="override-input"
            placeholder="Override reason..."
            value={overrideReason}
            onChange={(e) => setOverrideReason(e.target.value)}
          />
        )}

        <div className="checkpoint-actions">
          {!showOverride ? (
            <>
              <button className="btn reject" onClick={() => onAction('reject')}>Reject</button>
              <button className="btn override" onClick={() => setShowOverride(true)}>Override</button>
              <button className="btn approve" onClick={() => onAction('approve')}>Approve</button>
            </>
          ) : (
            <>
              <button className="btn" onClick={() => setShowOverride(false)}>Cancel</button>
              <button
                className="btn override"
                onClick={() => onAction('override')}
                disabled={!overrideReason.trim()}
              >
                Submit Override
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
