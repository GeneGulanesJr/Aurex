CREATE TABLE IF NOT EXISTS ai_inference_log (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    trigger_reason TEXT NOT NULL,
    gate_decision TEXT NOT NULL,
    repo_a TEXT,
    repo_b TEXT,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    estimated_cost_usd REAL NOT NULL DEFAULT 0,
    edges_suggested INTEGER NOT NULL DEFAULT 0,
    edges_auto_accepted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ai_edge_suggestions (
    id TEXT PRIMARY KEY,
    exporter_entity_id TEXT NOT NULL,
    consumer_entity_id TEXT NOT NULL,
    edge_type TEXT NOT NULL,
    reasoning TEXT NOT NULL,
    confidence REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY,
    suggestion_id TEXT NOT NULL,
    decision TEXT NOT NULL,
    reason TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS impact_reports (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    changed_repos TEXT NOT NULL,
    affected_repos TEXT NOT NULL,
    risk_score REAL NOT NULL,
    risk_level TEXT NOT NULL,
    report_json TEXT NOT NULL
);
