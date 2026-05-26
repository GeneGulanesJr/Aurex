CREATE TABLE IF NOT EXISTS broadcasts (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  milestone_id TEXT NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
  source_working_unit_id TEXT REFERENCES working_units(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'info' CHECK (category IN ('info', 'warning', 'decision', 'blocker')),
  lifecycle TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active', 'superseded', 'resolved', 'expired')),
  superseded_by TEXT REFERENCES broadcasts(id) ON DELETE SET NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_broadcasts_mission ON broadcasts(mission_id);
CREATE INDEX IF NOT EXISTS idx_broadcasts_lifecycle ON broadcasts(lifecycle);
CREATE INDEX IF NOT EXISTS idx_broadcasts_created ON broadcasts(mission_id, created_at DESC);

CREATE TABLE IF NOT EXISTS research_findings (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  milestone_id TEXT NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  findings TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'subagent' CHECK (source IN ('subagent', 'validator', 'negotiator')),
  relevance TEXT NOT NULL DEFAULT 'high' CHECK (relevance IN ('high', 'medium', 'low')),
  lifecycle TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active', 'superseded', 'archived')),
  superseded_by TEXT REFERENCES research_findings(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rf_mission ON research_findings(mission_id);
CREATE INDEX IF NOT EXISTS idx_rf_lifecycle ON research_findings(lifecycle);
CREATE INDEX IF NOT EXISTS idx_rf_milestone ON research_findings(milestone_id);
CREATE INDEX IF NOT EXISTS idx_rf_created ON research_findings(created_at DESC);
