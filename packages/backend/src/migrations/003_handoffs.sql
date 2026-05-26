CREATE TABLE IF NOT EXISTS handoffs (
  id TEXT PRIMARY KEY,
  working_unit_id TEXT NOT NULL REFERENCES working_units(id) ON DELETE CASCADE,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  milestone_id TEXT NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
  worker_output TEXT NOT NULL,
  files_modified_json TEXT NOT NULL DEFAULT '[]',
  rationale TEXT NOT NULL,
  assumptions_json TEXT NOT NULL DEFAULT '[]',
  summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_handoffs_wu ON handoffs(working_unit_id);
CREATE INDEX IF NOT EXISTS idx_handoffs_mission ON handoffs(mission_id);
CREATE INDEX IF NOT EXISTS idx_handoffs_milestone ON handoffs(milestone_id);
CREATE INDEX IF NOT EXISTS idx_handoffs_status ON handoffs(status);
