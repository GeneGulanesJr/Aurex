-- Aurex Migration 004: Broadcasts and Research Findings

CREATE TABLE IF NOT EXISTS broadcasts (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id),
  milestone_id TEXT NOT NULL REFERENCES milestones(id),
  source_worker_id TEXT REFERENCES working_units(id),
  content TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'info',
  lifecycle TEXT NOT NULL DEFAULT 'active',
  superseded_by TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_broadcasts_mission ON broadcasts(mission_id);
CREATE INDEX IF NOT EXISTS idx_broadcasts_lifecycle ON broadcasts(lifecycle);

CREATE TABLE IF NOT EXISTS research_findings (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id),
  milestone_id TEXT NOT NULL REFERENCES milestones(id),
  prompt TEXT NOT NULL,
  findings TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'subagent',
  relevance TEXT NOT NULL DEFAULT 'high',
  lifecycle TEXT NOT NULL DEFAULT 'active',
  superseded_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rf_mission ON research_findings(mission_id);
CREATE INDEX IF NOT EXISTS idx_rf_lifecycle ON research_findings(lifecycle);
