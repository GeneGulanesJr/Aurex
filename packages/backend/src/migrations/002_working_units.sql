CREATE TABLE IF NOT EXISTS working_units (
  id TEXT PRIMARY KEY,
  milestone_id TEXT NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  task_spec_json TEXT NOT NULL,
  file_paths_json TEXT NOT NULL DEFAULT '[]',
  modules_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'spawned', 'running', 'completed', 'timed_out', 'rejected')),
  pi_pid INTEGER CHECK (pi_pid IS NULL OR pi_pid > 0),
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wu_milestone ON working_units(milestone_id);
CREATE INDEX IF NOT EXISTS idx_wu_mission ON working_units(mission_id);
CREATE INDEX IF NOT EXISTS idx_wu_status ON working_units(status);
