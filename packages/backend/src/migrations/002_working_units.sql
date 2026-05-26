-- Aurex Migration 002: Working Units

CREATE TABLE IF NOT EXISTS working_units (
  id TEXT PRIMARY KEY,
  milestone_id TEXT NOT NULL REFERENCES milestones(id),
  mission_id TEXT NOT NULL REFERENCES missions(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  task_spec_json TEXT NOT NULL,
  file_paths_json TEXT NOT NULL DEFAULT '[]',
  modules_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  pi_pid INTEGER,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wu_milestone ON working_units(milestone_id);
CREATE INDEX IF NOT EXISTS idx_wu_mission ON working_units(mission_id);
CREATE INDEX IF NOT EXISTS idx_wu_status ON working_units(status);
