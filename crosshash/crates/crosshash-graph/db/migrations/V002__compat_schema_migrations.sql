-- Compatibility table requested by Phase 0. Refinery tracks applied migrations in
-- `refinery_schema_history`; this table exists for tools that look for the generic name.
CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
