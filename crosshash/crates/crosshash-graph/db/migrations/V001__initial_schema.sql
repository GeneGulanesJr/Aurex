CREATE TABLE repos (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    root_path TEXT NOT NULL,
    git_remote TEXT,
    default_branch TEXT NOT NULL,
    languages TEXT NOT NULL DEFAULT '[]',
    workspace_type TEXT NOT NULL DEFAULT '"None"',
    schema_version INTEGER NOT NULL DEFAULT 1,
    last_indexed_at TEXT NOT NULL,
    commit_hash TEXT NOT NULL
);

CREATE TABLE entities (
    id TEXT PRIMARY KEY,
    repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    language TEXT NOT NULL,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    qualified_name TEXT NOT NULL,
    signature TEXT NOT NULL,
    start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    start_byte INTEGER NOT NULL,
    end_byte INTEGER NOT NULL,
    signature_hash BLOB NOT NULL,
    content_hash BLOB NOT NULL,
    structural_hash BLOB NOT NULL,
    identity_hash BLOB NOT NULL,
    context_hash BLOB NOT NULL,
    visibility TEXT NOT NULL,
    is_exported INTEGER NOT NULL,
    is_async INTEGER NOT NULL,
    is_test INTEGER NOT NULL,
    first_seen_commit TEXT NOT NULL,
    last_seen_commit TEXT NOT NULL,
    deleted_at_commit TEXT
);

CREATE TABLE edges (
    id TEXT PRIMARY KEY,
    source_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    target_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 1.0,
    source TEXT NOT NULL,
    metadata TEXT,
    created_at TEXT NOT NULL,
    validated_at TEXT
);

CREATE TABLE entity_versions (
    entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    commit_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    qualified_name TEXT NOT NULL,
    signature TEXT NOT NULL,
    signature_hash BLOB NOT NULL,
    content_hash BLOB NOT NULL,
    structural_hash BLOB NOT NULL,
    identity_hash BLOB NOT NULL,
    context_hash BLOB NOT NULL,
    snapshot_at TEXT NOT NULL,
    PRIMARY KEY (entity_id, commit_hash)
);

CREATE VIEW public_api_surfaces AS
SELECT id AS entity_id, repo_id, name, qualified_name, kind, signature, signature_hash
FROM entities
WHERE is_exported = 1 AND deleted_at_commit IS NULL;

CREATE TABLE file_hashes (
    repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    content_hash BLOB NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (repo_id, file_path)
);

CREATE TABLE index_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_entities_repo_name_kind_signature_content
    ON entities(repo_id, name, kind, signature_hash, content_hash);
CREATE INDEX idx_edges_source_target_kind_confidence
    ON edges(source_entity_id, target_entity_id, kind, confidence);
CREATE INDEX idx_entity_versions_entity_commit
    ON entity_versions(entity_id, commit_hash);
