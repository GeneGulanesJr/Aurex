CREATE TABLE IF NOT EXISTS retry_counters (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  milestone_id TEXT NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
  working_unit_id TEXT REFERENCES working_units(id) ON DELETE CASCADE,
  retry_type TEXT NOT NULL CHECK (retry_type IN ('worker_timeout', 'validation_fail', 'negotiation_retry')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  last_attempt_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_retry_mission ON retry_counters(mission_id);
CREATE INDEX IF NOT EXISTS idx_retry_wu ON retry_counters(working_unit_id);

CREATE TABLE IF NOT EXISTS rescope_history (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  milestone_id TEXT NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
  original_spec_json TEXT NOT NULL,
  revised_spec_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  triggered_by TEXT NOT NULL CHECK (triggered_by IN ('negotiator', 'human', 'system')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rescope_mission ON rescope_history(mission_id);
CREATE INDEX IF NOT EXISTS idx_rescope_milestone ON rescope_history(milestone_id);

CREATE TABLE IF NOT EXISTS cost_entries (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  milestone_id TEXT REFERENCES milestones(id) ON DELETE CASCADE,
  working_unit_id TEXT REFERENCES working_units(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('planner', 'worker', 'validator', 'negotiator', 'researcher')),
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd INTEGER NOT NULL DEFAULT 0,
  provider TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cost_mission ON cost_entries(mission_id);
CREATE INDEX IF NOT EXISTS idx_cost_created ON cost_entries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cost_milestone ON cost_entries(milestone_id);
CREATE INDEX IF NOT EXISTS idx_cost_wu ON cost_entries(working_unit_id);
