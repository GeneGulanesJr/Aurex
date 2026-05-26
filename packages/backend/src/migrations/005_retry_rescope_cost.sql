-- Aurex Migration 005: Retry Counters, Rescope History, Cost Entries

CREATE TABLE IF NOT EXISTS retry_counters (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id),
  milestone_id TEXT NOT NULL REFERENCES milestones(id),
  working_unit_id TEXT REFERENCES working_units(id),
  retry_type TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  last_attempt_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_retry_mission ON retry_counters(mission_id);

CREATE TABLE IF NOT EXISTS rescope_history (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id),
  milestone_id TEXT NOT NULL REFERENCES milestones(id),
  original_spec_json TEXT NOT NULL,
  revised_spec_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  triggered_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rescope_mission ON rescope_history(mission_id);

CREATE TABLE IF NOT EXISTS cost_entries (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id),
  milestone_id TEXT REFERENCES milestones(id),
  working_unit_id TEXT REFERENCES working_units(id),
  role TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd REAL NOT NULL DEFAULT 0.0,
  provider TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cost_mission ON cost_entries(mission_id);
CREATE INDEX IF NOT EXISTS idx_cost_created ON cost_entries(created_at);
