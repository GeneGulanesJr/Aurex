# CrossHash v0.1 Phase 0-1-2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use Sequential mode for planned tasks or Direct mode if subagents aren't available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a tight, working CrossHash v0.1 that can index one Rust repository, extract entities, compute 5 BLAKE3 hashes, persist them to SQLite, build an intra-repo dependency graph, and answer `callers`, `callees`, and `blast-radius` queries from the CLI.

**Architecture:** CrossHash v0.1 is a Rust workspace under `crosshash/` with focused crates: `crosshash-core` for data types, `crosshash-graph` for SQLite + graph traversal, `crosshash-parser` for Tree-sitter Rust parsing/entity extraction, `crosshash-hash` for 5-hash computation, and `crosshash-cli` for user-facing commands. This plan intentionally defers AI, multi-repo indexing, MCP, HTTP, watch mode, 20+ languages, and git-history impact diffing until the single-repo graph loop is proven.

**Tech Stack:** Rust 2021, clap, indicatif, rusqlite, refinery, petgraph, tree-sitter, tree-sitter-rust, blake3, serde, uuid, chrono, thiserror, tempfile, assert_cmd.

---

## Scope Decisions

### Included in v0.1

- Cargo workspace under `crosshash/`.
- Core types compatible with existing `crosshash/crates/crosshash-graph/src/storage.rs`.
- SQLite migration that matches `storage.rs` queries.
- Rust language support only.
- Static entity extraction for Rust functions, structs, enums, traits, impl blocks, methods, modules, and constants.
- BLAKE3 5-hash computation.
- Intra-repo static edges for Rust:
  - `Contains`: parent entity contains child entity.
  - `Calls`: function/method body references a known entity name followed by `(`.
  - `Imports`: `use` declaration references a known entity qualified name or name.
- CLI commands:
  - `crosshash repo add <path> --name <name>`
  - `crosshash repo list`
  - `crosshash index --repo <name>`
  - `crosshash entity lookup <name> --repo <name>`
  - `crosshash graph callers <name> --repo <name> --depth <n>`
  - `crosshash graph callees <name> --repo <name> --depth <n>`
  - `crosshash graph blast-radius <name> --repo <name>`
- JSON output support via `--format json`.

### Explicitly deferred

- AI edge inference.
- Cross-repo indexing.
- Package manifest dependency resolution.
- Git history diffing.
- Incremental indexing.
- TypeScript/Python extraction.
- MCP/HTTP interfaces.
- Watch mode.
- SARIF/Markdown impact reports.

---

## File Structure

### Workspace files

- Create: `crosshash/Cargo.toml` — workspace manifest and shared dependency versions.
- Create: `crosshash/rustfmt.toml` — formatting rules.
- Create: `crosshash/clippy.toml` — lint configuration.
- Create: `crosshash/.github/workflows/ci.yml` — CrossHash-only CI.

### Core crate

- Create: `crosshash/crates/crosshash-core/Cargo.toml`
- Create: `crosshash/crates/crosshash-core/src/lib.rs`
- Create: `crosshash/crates/crosshash-core/src/error.rs`
- Create: `crosshash/crates/crosshash-core/src/types.rs`
- Create: `crosshash/crates/crosshash-core/src/edge_semantics.rs`

### Graph crate

- Create: `crosshash/crates/crosshash-graph/Cargo.toml`
- Create: `crosshash/crates/crosshash-graph/src/lib.rs`
- Keep/modify: `crosshash/crates/crosshash-graph/src/storage.rs`
- Create: `crosshash/crates/crosshash-graph/src/builder.rs`
- Create: `crosshash/crates/crosshash-graph/src/traversal.rs`
- Create: `crosshash/crates/crosshash-graph/db/migrations/V001__initial_schema.sql`

### Hash crate

- Create: `crosshash/crates/crosshash-hash/Cargo.toml`
- Create: `crosshash/crates/crosshash-hash/src/lib.rs`
- Create: `crosshash/crates/crosshash-hash/src/hasher.rs`

### Parser crate

- Create: `crosshash/crates/crosshash-parser/Cargo.toml`
- Create: `crosshash/crates/crosshash-parser/src/lib.rs`
- Create: `crosshash/crates/crosshash-parser/src/language_detect.rs`
- Create: `crosshash/crates/crosshash-parser/src/ignore.rs`
- Create: `crosshash/crates/crosshash-parser/src/parser.rs`
- Create: `crosshash/crates/crosshash-parser/src/rust_extractor.rs`

### CLI crate

- Create: `crosshash/crates/crosshash-cli/Cargo.toml`
- Create: `crosshash/crates/crosshash-cli/src/main.rs`
- Create: `crosshash/crates/crosshash-cli/src/commands.rs`
- Create: `crosshash/crates/crosshash-cli/src/output.rs`
- Create: `crosshash/crates/crosshash-cli/src/progress.rs`

---

## Task 1: Cargo Workspace Skeleton

**Files:**
- Create: `crosshash/Cargo.toml`
- Create: `crosshash/rustfmt.toml`
- Create: `crosshash/clippy.toml`
- Create: crate manifests and minimal `lib.rs`/`main.rs` files listed above.

- [ ] **Step 1: Write workspace manifest**

Create `crosshash/Cargo.toml`:

```toml
[workspace]
members = [
  "crates/crosshash-core",
  "crates/crosshash-graph",
  "crates/crosshash-hash",
  "crates/crosshash-parser",
  "crates/crosshash-cli",
]
resolver = "2"

[workspace.package]
edition = "2021"
version = "0.1.0"
license = "MIT"
repository = "https://github.com/GeneGulanesJr/LaPis"

[workspace.dependencies]
anyhow = "1"
assert_cmd = "2"
blake3 = "1"
chrono = { version = "0.4", features = ["serde"] }
clap = { version = "4", features = ["derive"] }
ignore = "0.4"
indicatif = "0.17"
petgraph = "0.6"
predicates = "3"
rayon = "1"
refinery = { version = "0.8", features = ["rusqlite"] }
rusqlite = { version = "0.31", features = ["bundled"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tempfile = "3"
thiserror = "1"
tree-sitter = "0.22"
tree-sitter-rust = "0.21"
uuid = { version = "1", features = ["v7", "v5", "serde"] }
walkdir = "2"
```

- [ ] **Step 2: Add formatting configs**

Create `crosshash/rustfmt.toml`:

```toml
edition = "2021"
max_width = 100
use_small_heuristics = "Max"
```

Create `crosshash/clippy.toml`:

```toml
avoid-breaking-exported-api = false
```

- [ ] **Step 3: Add minimal crate manifests**

Create `crosshash/crates/crosshash-core/Cargo.toml`:

```toml
[package]
name = "crosshash-core"
version.workspace = true
edition.workspace = true
license.workspace = true
repository.workspace = true

[dependencies]
chrono.workspace = true
serde.workspace = true
serde_json.workspace = true
thiserror.workspace = true
uuid.workspace = true
```

Create `crosshash/crates/crosshash-graph/Cargo.toml`:

```toml
[package]
name = "crosshash-graph"
version.workspace = true
edition.workspace = true
license.workspace = true
repository.workspace = true

[dependencies]
chrono.workspace = true
crosshash-core = { path = "../crosshash-core" }
petgraph.workspace = true
refinery.workspace = true
rusqlite.workspace = true
serde_json.workspace = true
uuid.workspace = true

[dev-dependencies]
tempfile.workspace = true
```

Create `crosshash/crates/crosshash-hash/Cargo.toml`:

```toml
[package]
name = "crosshash-hash"
version.workspace = true
edition.workspace = true
license.workspace = true
repository.workspace = true

[dependencies]
blake3.workspace = true
crosshash-core = { path = "../crosshash-core" }
```

Create `crosshash/crates/crosshash-parser/Cargo.toml`:

```toml
[package]
name = "crosshash-parser"
version.workspace = true
edition.workspace = true
license.workspace = true
repository.workspace = true

[dependencies]
chrono.workspace = true
crosshash-core = { path = "../crosshash-core" }
crosshash-hash = { path = "../crosshash-hash" }
ignore.workspace = true
rayon.workspace = true
tree-sitter.workspace = true
tree-sitter-rust.workspace = true
uuid.workspace = true
walkdir.workspace = true
```

Create `crosshash/crates/crosshash-cli/Cargo.toml`:

```toml
[package]
name = "crosshash"
version.workspace = true
edition.workspace = true
license.workspace = true
repository.workspace = true

[[bin]]
name = "crosshash"
path = "src/main.rs"

[dependencies]
anyhow.workspace = true
clap.workspace = true
crosshash-core = { path = "../crosshash-core" }
crosshash-graph = { path = "../crosshash-graph" }
crosshash-parser = { path = "../crosshash-parser" }
indicatif.workspace = true
serde_json.workspace = true
uuid.workspace = true

[dev-dependencies]
assert_cmd.workspace = true
predicates.workspace = true
tempfile.workspace = true
```

- [ ] **Step 4: Add minimal source files**

Create `crosshash/crates/crosshash-core/src/lib.rs`:

```rust
pub mod edge_semantics;
pub mod error;
pub mod types;

pub use error::{CoreError, Result};
pub use types::*;
```

Create `crosshash/crates/crosshash-graph/src/lib.rs`:

```rust
pub mod builder;
pub mod storage;
pub mod traversal;
```

Create `crosshash/crates/crosshash-hash/src/lib.rs`:

```rust
pub mod hasher;
```

Create `crosshash/crates/crosshash-parser/src/lib.rs`:

```rust
pub mod ignore;
pub mod language_detect;
pub mod parser;
pub mod rust_extractor;
```

Create `crosshash/crates/crosshash-cli/src/main.rs`:

```rust
fn main() {
    println!("crosshash v0.1.0");
}
```

Create placeholder module files that compile:

```bash
printf '' > crosshash/crates/crosshash-core/src/edge_semantics.rs
printf '' > crosshash/crates/crosshash-core/src/error.rs
printf '' > crosshash/crates/crosshash-core/src/types.rs
printf '' > crosshash/crates/crosshash-graph/src/builder.rs
printf '' > crosshash/crates/crosshash-graph/src/traversal.rs
printf '' > crosshash/crates/crosshash-hash/src/hasher.rs
printf '' > crosshash/crates/crosshash-parser/src/ignore.rs
printf '' > crosshash/crates/crosshash-parser/src/language_detect.rs
printf '' > crosshash/crates/crosshash-parser/src/parser.rs
printf '' > crosshash/crates/crosshash-parser/src/rust_extractor.rs
```

- [ ] **Step 5: Run workspace build**

Run:

```bash
cd crosshash
cargo build
```

Expected: build fails only because `storage.rs` references missing core types. This confirms the workspace resolves but core types still need implementation.

- [ ] **Step 6: Commit**

```bash
git add crosshash/Cargo.toml crosshash/rustfmt.toml crosshash/clippy.toml crosshash/crates
git commit -m "feat(crosshash): add Rust workspace skeleton"
```

---

## Task 2: Core Types Compatible With Existing Storage

**Files:**
- Modify: `crosshash/crates/crosshash-core/src/error.rs`
- Modify: `crosshash/crates/crosshash-core/src/types.rs`
- Modify: `crosshash/crates/crosshash-core/src/edge_semantics.rs`

- [ ] **Step 1: Implement error type**

Write `crosshash/crates/crosshash-core/src/error.rs`:

```rust
use thiserror::Error;

pub type Result<T> = std::result::Result<T, CoreError>;

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("storage error: {0}")]
    StorageError(String),

    #[error("migration error: {0}")]
    MigrationError(String),

    #[error("parse error: {0}")]
    ParseError(String),

    #[error("hash error: {0}")]
    HashError(String),

    #[error("graph error: {0}")]
    GraphError(String),

    #[error("entity not found: {0}")]
    EntityNotFound(String),

    #[error("repo not found: {0}")]
    RepoNotFound(String),

    #[error("unsupported language: {0}")]
    UnsupportedLanguage(String),

    #[error("io error: {0}")]
    Io(String),
}

impl From<std::io::Error> for CoreError {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value.to_string())
    }
}
```

- [ ] **Step 2: Implement core structs and enums**

Write `crosshash/crates/crosshash-core/src/types.rs`:

```rust
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

pub type Hash32 = [u8; 32];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Language {
    Rust,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EntityKind {
    Function,
    Method,
    Struct,
    Enum,
    Trait,
    Impl,
    Module,
    Const,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EdgeKind {
    Calls,
    Imports,
    Contains,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EdgeSource {
    Static,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Visibility {
    Public,
    Private,
    Crate,
    Restricted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WorkspaceType {
    None,
    CargoWorkspace,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ChangeType {
    Unchanged,
    Added,
    Deleted,
    BodyOnly,
    SignatureChanged,
    Moved,
    Renamed,
    Modified,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ImpactType {
    Safe,
    NeedsUpdate,
    Breaking,
    Investigate,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RiskLevel {
    Low,
    Medium,
    High,
    Critical,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EntityHashes {
    pub signature_hash: Hash32,
    pub content_hash: Hash32,
    pub structural_hash: Hash32,
    pub identity_hash: Hash32,
    pub context_hash: Hash32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Repo {
    pub id: Uuid,
    pub name: String,
    pub root_path: String,
    pub git_remote: Option<String>,
    pub default_branch: String,
    pub languages: Vec<Language>,
    pub workspace_type: WorkspaceType,
    pub last_indexed_at: DateTime<Utc>,
    pub commit_hash: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Entity {
    pub id: Uuid,
    pub repo_id: Uuid,
    pub file_path: String,
    pub language: Language,
    pub kind: EntityKind,
    pub name: String,
    pub qualified_name: String,
    pub signature: String,
    pub start_line: u32,
    pub end_line: u32,
    pub start_byte: u32,
    pub end_byte: u32,
    pub signature_hash: Hash32,
    pub content_hash: Hash32,
    pub structural_hash: Hash32,
    pub identity_hash: Hash32,
    pub context_hash: Hash32,
    pub visibility: Visibility,
    pub is_exported: bool,
    pub is_async: bool,
    pub is_test: bool,
    pub first_seen_commit: String,
    pub last_seen_commit: String,
    pub deleted_at_commit: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Edge {
    pub id: Uuid,
    pub source_entity_id: Uuid,
    pub target_entity_id: Uuid,
    pub kind: EdgeKind,
    pub confidence: f64,
    pub source: EdgeSource,
    pub metadata: Option<Value>,
    pub created_at: DateTime<Utc>,
    pub validated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EntityVersion {
    pub entity_id: Uuid,
    pub commit_hash: String,
    pub name: String,
    pub qualified_name: String,
    pub signature: String,
    pub signature_hash: Hash32,
    pub content_hash: Hash32,
    pub structural_hash: Hash32,
    pub identity_hash: Hash32,
    pub context_hash: Hash32,
    pub snapshot_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChangedEntity {
    pub entity_id: Uuid,
    pub change_type: ChangeType,
    pub old_hashes: Option<EntityHashes>,
    pub new_hashes: Option<EntityHashes>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ImpactReport {
    pub id: Uuid,
    pub changed_repos: Vec<Uuid>,
    pub affected_repos: Vec<Uuid>,
    pub changed_entities: Vec<ChangedEntity>,
    pub risk_level: RiskLevel,
    pub risk_score: f64,
    pub impact_type: ImpactType,
    pub generated_at: DateTime<Utc>,
}
```

- [ ] **Step 3: Document edge convention**

Write `crosshash/crates/crosshash-core/src/edge_semantics.rs`:

```rust
//! Edge direction convention for CrossHash.
//!
//! CrossHash stores every dependency edge as:
//!
//! `source -> target = source depends on target`
//!
//! Examples:
//! - Function A calls function B: `A -> B`
//! - Module A imports module B: `A -> B`
//! - Method A is contained by impl B: `B -> A` for `Contains`
//!
//! Impact analysis follows reverse edges. If B changes, callers/importers that
//! depend on B are found by walking incoming edges from B back to A.

pub const EDGE_DIRECTION_SUMMARY: &str = "source -> target means source depends on target";
```

- [ ] **Step 4: Add core type tests**

Append to `types.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edge_kind_serializes_as_json_string() {
        let json = serde_json::to_string(&EdgeKind::Calls).unwrap();
        assert_eq!(json, "\"Calls\"");
        let parsed: EdgeKind = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, EdgeKind::Calls);
    }

    #[test]
    fn repo_round_trips_through_json() {
        let repo = Repo {
            id: Uuid::now_v7(),
            name: "demo".to_string(),
            root_path: "/tmp/demo".to_string(),
            git_remote: None,
            default_branch: "main".to_string(),
            languages: vec![Language::Rust],
            workspace_type: WorkspaceType::None,
            last_indexed_at: Utc::now(),
            commit_hash: "HEAD".to_string(),
        };
        let json = serde_json::to_string(&repo).unwrap();
        let parsed: Repo = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.name, repo.name);
        assert_eq!(parsed.languages, repo.languages);
    }
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
cd crosshash
cargo test -p crosshash-core
```

Expected: all `crosshash-core` tests pass.

- [ ] **Step 6: Commit**

```bash
git add crosshash/crates/crosshash-core
git commit -m "feat(crosshash-core): define v0.1 data model"
```

---

## Task 3: SQLite Schema and Storage Integration

**Files:**
- Create: `crosshash/crates/crosshash-graph/db/migrations/V001__initial_schema.sql`
- Modify: `crosshash/crates/crosshash-graph/src/storage.rs`

- [ ] **Step 1: Add initial migration**

Create `crosshash/crates/crosshash-graph/db/migrations/V001__initial_schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS repos (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    root_path TEXT NOT NULL,
    git_remote TEXT,
    default_branch TEXT NOT NULL,
    languages TEXT NOT NULL,
    workspace_type TEXT NOT NULL,
    last_indexed_at TEXT NOT NULL,
    commit_hash TEXT NOT NULL,
    schema_version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS entities (
    id TEXT PRIMARY KEY,
    repo_id TEXT NOT NULL,
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
    deleted_at_commit TEXT,
    FOREIGN KEY(repo_id) REFERENCES repos(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS edges (
    id TEXT PRIMARY KEY,
    source_entity_id TEXT NOT NULL,
    target_entity_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    confidence REAL NOT NULL,
    source TEXT NOT NULL,
    metadata TEXT,
    created_at TEXT NOT NULL,
    validated_at TEXT,
    FOREIGN KEY(source_entity_id) REFERENCES entities(id) ON DELETE CASCADE,
    FOREIGN KEY(target_entity_id) REFERENCES entities(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS entity_versions (
    entity_id TEXT NOT NULL,
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
    PRIMARY KEY(entity_id, commit_hash),
    FOREIGN KEY(entity_id) REFERENCES entities(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS file_hashes (
    repo_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    content_hash BLOB NOT NULL,
    PRIMARY KEY(repo_id, file_path),
    FOREIGN KEY(repo_id) REFERENCES repos(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS index_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_entities_repo_name_kind ON entities(repo_id, name, kind);
CREATE INDEX IF NOT EXISTS idx_entities_repo_qualified_name ON entities(repo_id, qualified_name);
CREATE INDEX IF NOT EXISTS idx_entities_signature_hash ON entities(signature_hash);
CREATE INDEX IF NOT EXISTS idx_entities_content_hash ON entities(content_hash);
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_entity_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_entity_id);
CREATE INDEX IF NOT EXISTS idx_edges_kind_confidence ON edges(kind, confidence);
CREATE INDEX IF NOT EXISTS idx_entity_versions_entity_commit ON entity_versions(entity_id, commit_hash);
```

- [ ] **Step 2: Fix embedded migration path if needed**

In `storage.rs`, keep:

```rust
mod embedded {
    use refinery::embed_migrations;
    embed_migrations!("db/migrations");
}
```

Rationale: the path is relative to the crate root, not `src/storage.rs`.

- [ ] **Step 3: Run graph tests**

Run:

```bash
cd crosshash
cargo test -p crosshash-graph storage
```

Expected: existing `storage.rs` tests compile and pass.

- [ ] **Step 4: Commit**

```bash
git add crosshash/crates/crosshash-graph/db/migrations crosshash/crates/crosshash-graph/src/storage.rs
git commit -m "feat(crosshash-graph): add SQLite schema and storage tests"
```

---

## Task 4: BLAKE3 5-Hash Computation

**Files:**
- Modify: `crosshash/crates/crosshash-hash/src/hasher.rs`
- Modify: `crosshash/crates/crosshash-hash/src/lib.rs`

- [ ] **Step 1: Implement hasher**

Write `crosshash/crates/crosshash-hash/src/hasher.rs`:

```rust
use crosshash_core::{EntityKind, Hash32};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HashInput {
    pub kind: EntityKind,
    pub signature: String,
    pub body: String,
    pub structural_repr: String,
    pub identity_repr: String,
    pub parent_structural_hash: Option<Hash32>,
    pub depth: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ComputedHashes {
    pub signature_hash: Hash32,
    pub content_hash: Hash32,
    pub structural_hash: Hash32,
    pub identity_hash: Hash32,
    pub context_hash: Hash32,
}

pub struct EntityHasher;

impl EntityHasher {
    pub fn compute(input: &HashInput) -> ComputedHashes {
        ComputedHashes {
            signature_hash: hash_bytes(input.signature.as_bytes()),
            content_hash: hash_bytes(input.body.as_bytes()),
            structural_hash: hash_bytes(input.structural_repr.as_bytes()),
            identity_hash: hash_bytes(input.identity_repr.as_bytes()),
            context_hash: compute_context_hash(input.parent_structural_hash, input.depth),
        }
    }
}

pub fn hash_bytes(bytes: &[u8]) -> Hash32 {
    *blake3::hash(bytes).as_bytes()
}

fn compute_context_hash(parent: Option<Hash32>, depth: u32) -> Hash32 {
    let mut hasher = blake3::Hasher::new();
    match parent {
        Some(parent_hash) => hasher.update(&parent_hash),
        None => hasher.update(&[0u8; 32]),
    };
    hasher.update(&depth.to_le_bytes());
    *hasher.finalize().as_bytes()
}
```

- [ ] **Step 2: Export hasher types**

Write `crosshash/crates/crosshash-hash/src/lib.rs`:

```rust
pub mod hasher;

pub use hasher::{hash_bytes, ComputedHashes, EntityHasher, HashInput};
```

- [ ] **Step 3: Add tests**

Append to `hasher.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crosshash_core::EntityKind;

    fn input(signature: &str, body: &str) -> HashInput {
        HashInput {
            kind: EntityKind::Function,
            signature: signature.to_string(),
            body: body.to_string(),
            structural_repr: "function(parameters block)".to_string(),
            identity_repr: "function(_ _)".to_string(),
            parent_structural_hash: None,
            depth: 0,
        }
    }

    #[test]
    fn identical_input_has_identical_hashes() {
        let a = EntityHasher::compute(&input("fn a()", "fn a() {}"));
        let b = EntityHasher::compute(&input("fn a()", "fn a() {}"));
        assert_eq!(a, b);
    }

    #[test]
    fn body_only_change_preserves_signature_hash() {
        let a = EntityHasher::compute(&input("fn a() -> u32", "fn a() -> u32 { 1 }"));
        let b = EntityHasher::compute(&input("fn a() -> u32", "fn a() -> u32 { 2 }"));
        assert_eq!(a.signature_hash, b.signature_hash);
        assert_ne!(a.content_hash, b.content_hash);
    }

    #[test]
    fn signature_change_changes_signature_hash() {
        let a = EntityHasher::compute(&input("fn a() -> u32", "fn a() -> u32 { 1 }"));
        let b = EntityHasher::compute(&input("fn a(x: u32) -> u32", "fn a(x: u32) -> u32 { x }"));
        assert_ne!(a.signature_hash, b.signature_hash);
    }
}
```

- [ ] **Step 4: Run tests**

```bash
cd crosshash
cargo test -p crosshash-hash
```

Expected: all hash tests pass.

- [ ] **Step 5: Commit**

```bash
git add crosshash/crates/crosshash-hash
git commit -m "feat(crosshash-hash): compute BLAKE3 entity hashes"
```

---

## Task 5: Rust Language Detection and File Filtering

**Files:**
- Modify: `crosshash/crates/crosshash-parser/src/language_detect.rs`
- Modify: `crosshash/crates/crosshash-parser/src/ignore.rs`

- [ ] **Step 1: Implement language detection**

Write `crosshash/crates/crosshash-parser/src/language_detect.rs`:

```rust
use crosshash_core::{CoreError, Language, Result};
use std::path::Path;

pub fn detect_language(path: &Path) -> Result<Option<Language>> {
    match path.extension().and_then(|e| e.to_str()) {
        Some("rs") => Ok(Some(Language::Rust)),
        Some(_) | None => Ok(None),
    }
}

pub fn require_language(path: &Path) -> Result<Language> {
    detect_language(path)?.ok_or_else(|| {
        CoreError::UnsupportedLanguage(path.to_string_lossy().to_string())
    })
}
```

- [ ] **Step 2: Implement file collection**

Write `crosshash/crates/crosshash-parser/src/ignore.rs`:

```rust
use crosshash_core::Result;
use ignore::WalkBuilder;
use std::path::{Path, PathBuf};

pub fn collect_rust_files(root: &Path) -> Result<Vec<PathBuf>> {
    let mut files = Vec::new();
    let walker = WalkBuilder::new(root)
        .hidden(false)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .filter_entry(|entry| {
            let name = entry.file_name().to_string_lossy();
            !matches!(name.as_ref(), "target" | ".git" | "node_modules" | "dist" | "build")
        })
        .build();

    for result in walker {
        let entry = result.map_err(|e| crosshash_core::CoreError::Io(e.to_string()))?;
        if entry.file_type().map(|ft| ft.is_file()).unwrap_or(false)
            && entry.path().extension().and_then(|e| e.to_str()) == Some("rs")
        {
            files.push(entry.path().to_path_buf());
        }
    }

    files.sort();
    Ok(files)
}
```

- [ ] **Step 3: Add tests**

Append to `language_detect.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn detects_rust_files() {
        assert_eq!(detect_language(Path::new("src/lib.rs")).unwrap(), Some(Language::Rust));
    }

    #[test]
    fn skips_unknown_extensions() {
        assert_eq!(detect_language(Path::new("README.md")).unwrap(), None);
    }
}
```

Append to `ignore.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn collects_rust_files_and_skips_target() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("src")).unwrap();
        fs::create_dir_all(dir.path().join("target/debug")).unwrap();
        fs::write(dir.path().join("src/lib.rs"), "fn main() {}").unwrap();
        fs::write(dir.path().join("target/debug/build.rs"), "fn ignored() {}").unwrap();

        let files = collect_rust_files(dir.path()).unwrap();
        assert_eq!(files.len(), 1);
        assert!(files[0].ends_with("src/lib.rs"));
    }
}
```

Add `tempfile.workspace = true` to `crosshash-parser` dev-dependencies.

- [ ] **Step 4: Run tests**

```bash
cd crosshash
cargo test -p crosshash-parser language_detect ignore
```

Expected: language detection and file filtering tests pass.

- [ ] **Step 5: Commit**

```bash
git add crosshash/crates/crosshash-parser
git commit -m "feat(crosshash-parser): detect and collect Rust files"
```

---

## Task 6: Rust Parser and Entity Extraction

**Files:**
- Modify: `crosshash/crates/crosshash-parser/src/parser.rs`
- Modify: `crosshash/crates/crosshash-parser/src/rust_extractor.rs`

- [ ] **Step 1: Implement Tree-sitter parser wrapper**

Write `crosshash/crates/crosshash-parser/src/parser.rs`:

```rust
use crosshash_core::{CoreError, Result};
use std::fs;
use std::path::Path;
use tree_sitter::{Parser, Tree};

pub struct ParsedFile {
    pub source: String,
    pub tree: Tree,
}

pub fn parse_rust_file(path: &Path) -> Result<ParsedFile> {
    let source = fs::read_to_string(path)?;
    parse_rust_source(&source)
}

pub fn parse_rust_source(source: &str) -> Result<ParsedFile> {
    let mut parser = Parser::new();
    parser
        .set_language(&tree_sitter_rust::language())
        .map_err(|e| CoreError::ParseError(e.to_string()))?;
    let tree = parser
        .parse(source, None)
        .ok_or_else(|| CoreError::ParseError("tree-sitter returned no tree".to_string()))?;
    Ok(ParsedFile {
        source: source.to_string(),
        tree,
    })
}
```

- [ ] **Step 2: Implement Rust entity extractor**

Write `crosshash/crates/crosshash-parser/src/rust_extractor.rs`:

```rust
use crosshash_core::{Entity, EntityKind, Language, Visibility};
use crosshash_hash::{EntityHasher, HashInput};
use std::path::Path;
use tree_sitter::{Node, Tree};
use uuid::Uuid;

pub fn extract_rust_entities(
    repo_id: Uuid,
    repo_root: &Path,
    file_path: &Path,
    source: &str,
    tree: &Tree,
    commit_hash: &str,
) -> Vec<Entity> {
    let relative_path = file_path
        .strip_prefix(repo_root)
        .unwrap_or(file_path)
        .to_string_lossy()
        .to_string();
    let mut entities = Vec::new();
    walk_node(
        repo_id,
        &relative_path,
        source,
        tree.root_node(),
        commit_hash,
        &mut Vec::new(),
        &mut entities,
    );
    entities
}

fn walk_node(
    repo_id: Uuid,
    file_path: &str,
    source: &str,
    node: Node,
    commit_hash: &str,
    parents: &mut Vec<String>,
    entities: &mut Vec<Entity>,
) {
    if let Some((kind, name, signature, visibility)) = entity_from_node(source, node) {
        let qualified_name = if parents.is_empty() {
            name.clone()
        } else {
            format!("{}::{}", parents.join("::"), name)
        };
        let body = node_text(source, node).to_string();
        let structural_repr = structural_repr(node);
        let identity_repr = identity_repr(node);
        let parent_structural_hash = None;
        let hashes = EntityHasher::compute(&HashInput {
            kind,
            signature: signature.clone(),
            body,
            structural_repr,
            identity_repr,
            parent_structural_hash,
            depth: parents.len() as u32,
        });
        let entity = Entity {
            id: Uuid::new_v5(&repo_id, format!("{}:{}:{}", file_path, kind as u8, qualified_name).as_bytes()),
            repo_id,
            file_path: file_path.to_string(),
            language: Language::Rust,
            kind,
            name: name.clone(),
            qualified_name: qualified_name.clone(),
            signature,
            start_line: node.start_position().row as u32 + 1,
            end_line: node.end_position().row as u32 + 1,
            start_byte: node.start_byte() as u32,
            end_byte: node.end_byte() as u32,
            signature_hash: hashes.signature_hash,
            content_hash: hashes.content_hash,
            structural_hash: hashes.structural_hash,
            identity_hash: hashes.identity_hash,
            context_hash: hashes.context_hash,
            visibility,
            is_exported: visibility == Visibility::Public,
            is_async: node_text(source, node).contains("async fn"),
            is_test: node_text(source, node).contains("#[test]"),
            first_seen_commit: commit_hash.to_string(),
            last_seen_commit: commit_hash.to_string(),
            deleted_at_commit: None,
        };
        entities.push(entity);
        parents.push(name);
        walk_children(repo_id, file_path, source, node, commit_hash, parents, entities);
        parents.pop();
    } else {
        walk_children(repo_id, file_path, source, node, commit_hash, parents, entities);
    }
}

fn walk_children(
    repo_id: Uuid,
    file_path: &str,
    source: &str,
    node: Node,
    commit_hash: &str,
    parents: &mut Vec<String>,
    entities: &mut Vec<Entity>,
) {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        walk_node(repo_id, file_path, source, child, commit_hash, parents, entities);
    }
}

fn entity_from_node(source: &str, node: Node) -> Option<(EntityKind, String, String, Visibility)> {
    let kind = match node.kind() {
        "function_item" => EntityKind::Function,
        "struct_item" => EntityKind::Struct,
        "enum_item" => EntityKind::Enum,
        "trait_item" => EntityKind::Trait,
        "impl_item" => EntityKind::Impl,
        "mod_item" => EntityKind::Module,
        "const_item" => EntityKind::Const,
        _ => return None,
    };
    let name = name_child(source, node).unwrap_or_else(|| format!("anonymous_{}", node.start_byte()));
    let signature = signature_text(source, node);
    let visibility = if node_text(source, node).trim_start().starts_with("pub(crate)") {
        Visibility::Crate
    } else if node_text(source, node).trim_start().starts_with("pub(") {
        Visibility::Restricted
    } else if node_text(source, node).trim_start().starts_with("pub") {
        Visibility::Public
    } else {
        Visibility::Private
    };
    Some((kind, name, signature, visibility))
}

fn name_child(source: &str, node: Node) -> Option<String> {
    node.child_by_field_name("name")
        .map(|n| node_text(source, n).to_string())
}

fn signature_text(source: &str, node: Node) -> String {
    let text = node_text(source, node);
    match text.find('{') {
        Some(idx) => text[..idx].trim().to_string(),
        None => text.lines().next().unwrap_or(text).trim().to_string(),
    }
}

fn structural_repr(node: Node) -> String {
    let mut parts = vec![node.kind().to_string()];
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        parts.push(child.kind().to_string());
    }
    parts.join(" ")
}

fn identity_repr(node: Node) -> String {
    format!("{}:{}", node.kind(), node.child_count())
}

fn node_text<'a>(source: &'a str, node: Node) -> &'a str {
    &source[node.start_byte()..node.end_byte()]
}
```

- [ ] **Step 3: Add parser/extractor tests**

Append to `rust_extractor.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::parse_rust_source;

    #[test]
    fn extracts_public_rust_function() {
        let source = "pub fn hello(name: &str) -> String { format!(\"hi {name}\") }";
        let parsed = parse_rust_source(source).unwrap();
        let repo_id = Uuid::now_v7();
        let entities = extract_rust_entities(
            repo_id,
            Path::new("/repo"),
            Path::new("/repo/src/lib.rs"),
            source,
            &parsed.tree,
            "HEAD",
        );
        assert_eq!(entities.len(), 1);
        assert_eq!(entities[0].name, "hello");
        assert_eq!(entities[0].kind, EntityKind::Function);
        assert_eq!(entities[0].visibility, Visibility::Public);
        assert!(entities[0].is_exported);
    }
}
```

- [ ] **Step 4: Run tests**

```bash
cd crosshash
cargo test -p crosshash-parser rust_extractor
```

Expected: Rust extraction tests pass.

- [ ] **Step 5: Commit**

```bash
git add crosshash/crates/crosshash-parser
git commit -m "feat(crosshash-parser): extract Rust entities with hashes"
```

---

## Task 7: Graph Builder and Traversal

**Files:**
- Modify: `crosshash/crates/crosshash-graph/src/builder.rs`
- Modify: `crosshash/crates/crosshash-graph/src/traversal.rs`

- [ ] **Step 1: Implement graph builder**

Write `crosshash/crates/crosshash-graph/src/builder.rs`:

```rust
use crate::storage::GraphStorage;
use crosshash_core::{CoreError, Edge, Entity, Result};
use petgraph::graph::{DiGraph, NodeIndex};
use std::collections::HashMap;
use uuid::Uuid;

pub struct EntityGraph {
    pub graph: DiGraph<Entity, Edge>,
    pub node_by_entity_id: HashMap<Uuid, NodeIndex>,
}

pub struct GraphBuilder;

impl GraphBuilder {
    pub fn build_for_repo(storage: &GraphStorage, repo_id: Uuid) -> Result<EntityGraph> {
        let entities = storage.get_entities_by_repo(repo_id)?;
        let edges = storage.get_edges_by_repo(repo_id)?;
        Self::build(entities, edges)
    }

    pub fn build(entities: Vec<Entity>, edges: Vec<Edge>) -> Result<EntityGraph> {
        let mut graph = DiGraph::new();
        let mut node_by_entity_id = HashMap::new();

        for entity in entities {
            let id = entity.id;
            let node = graph.add_node(entity);
            node_by_entity_id.insert(id, node);
        }

        for edge in edges {
            let source = *node_by_entity_id.get(&edge.source_entity_id).ok_or_else(|| {
                CoreError::GraphError(format!("missing source entity {}", edge.source_entity_id))
            })?;
            let target = *node_by_entity_id.get(&edge.target_entity_id).ok_or_else(|| {
                CoreError::GraphError(format!("missing target entity {}", edge.target_entity_id))
            })?;
            graph.add_edge(source, target, edge);
        }

        Ok(EntityGraph {
            graph,
            node_by_entity_id,
        })
    }
}
```

- [ ] **Step 2: Implement traversal**

Write `crosshash/crates/crosshash-graph/src/traversal.rs`:

```rust
use crate::builder::EntityGraph;
use crosshash_core::{CoreError, Edge, Entity, Result};
use petgraph::Direction;
use std::collections::{HashSet, VecDeque};
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct TraversalHit {
    pub entity: Entity,
    pub depth: usize,
    pub via_edges: Vec<Edge>,
}

pub struct GraphTraversal<'a> {
    graph: &'a EntityGraph,
}

impl<'a> GraphTraversal<'a> {
    pub fn new(graph: &'a EntityGraph) -> Self {
        Self { graph }
    }

    pub fn callers(&self, entity_id: Uuid, max_depth: usize) -> Result<Vec<TraversalHit>> {
        self.walk(entity_id, max_depth, Direction::Incoming)
    }

    pub fn callees(&self, entity_id: Uuid, max_depth: usize) -> Result<Vec<TraversalHit>> {
        self.walk(entity_id, max_depth, Direction::Outgoing)
    }

    pub fn blast_radius(&self, entity_id: Uuid) -> Result<Vec<TraversalHit>> {
        self.walk(entity_id, usize::MAX, Direction::Incoming)
    }

    fn walk(&self, entity_id: Uuid, max_depth: usize, direction: Direction) -> Result<Vec<TraversalHit>> {
        let start = *self.graph.node_by_entity_id.get(&entity_id).ok_or_else(|| {
            CoreError::EntityNotFound(entity_id.to_string())
        })?;
        let mut visited = HashSet::new();
        let mut queue = VecDeque::new();
        let mut hits = Vec::new();

        visited.insert(start);
        queue.push_back((start, 0usize, Vec::new()));

        while let Some((node, depth, path)) = queue.pop_front() {
            if depth >= max_depth {
                continue;
            }
            for edge_ref in self.graph.graph.edges_directed(node, direction) {
                let next = match direction {
                    Direction::Incoming => edge_ref.source(),
                    Direction::Outgoing => edge_ref.target(),
                };
                if !visited.insert(next) {
                    continue;
                }
                let mut next_path = path.clone();
                next_path.push(edge_ref.weight().clone());
                let entity = self.graph.graph[next].clone();
                hits.push(TraversalHit {
                    entity: entity.clone(),
                    depth: depth + 1,
                    via_edges: next_path.clone(),
                });
                queue.push_back((next, depth + 1, next_path));
            }
        }

        Ok(hits)
    }
}

use petgraph::visit::EdgeRef;
```

- [ ] **Step 3: Add tests**

Append to `traversal.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::builder::GraphBuilder;
    use chrono::Utc;
    use crosshash_core::{EdgeKind, EdgeSource, EntityKind, Language, Visibility};

    fn entity(name: &str) -> Entity {
        Entity {
            id: Uuid::now_v7(),
            repo_id: Uuid::now_v7(),
            file_path: "src/lib.rs".to_string(),
            language: Language::Rust,
            kind: EntityKind::Function,
            name: name.to_string(),
            qualified_name: name.to_string(),
            signature: format!("fn {name}()"),
            start_line: 1,
            end_line: 1,
            start_byte: 0,
            end_byte: 10,
            signature_hash: [1; 32],
            content_hash: [2; 32],
            structural_hash: [3; 32],
            identity_hash: [4; 32],
            context_hash: [5; 32],
            visibility: Visibility::Private,
            is_exported: false,
            is_async: false,
            is_test: false,
            first_seen_commit: "HEAD".to_string(),
            last_seen_commit: "HEAD".to_string(),
            deleted_at_commit: None,
        }
    }

    #[test]
    fn callers_walks_reverse_edges() {
        let caller = entity("caller");
        let callee = entity("callee");
        let edge = Edge {
            id: Uuid::now_v7(),
            source_entity_id: caller.id,
            target_entity_id: callee.id,
            kind: EdgeKind::Calls,
            confidence: 1.0,
            source: EdgeSource::Static,
            metadata: None,
            created_at: Utc::now(),
            validated_at: None,
        };
        let graph = GraphBuilder::build(vec![caller.clone(), callee.clone()], vec![edge]).unwrap();
        let traversal = GraphTraversal::new(&graph);
        let hits = traversal.callers(callee.id, 1).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].entity.name, "caller");
    }
}
```

- [ ] **Step 4: Run tests**

```bash
cd crosshash
cargo test -p crosshash-graph traversal builder
```

Expected: graph traversal tests pass.

- [ ] **Step 5: Commit**

```bash
git add crosshash/crates/crosshash-graph/src/builder.rs crosshash/crates/crosshash-graph/src/traversal.rs
git commit -m "feat(crosshash-graph): build and traverse entity graphs"
```

---

## Task 8: Intra-Repo Static Edge Extraction

**Files:**
- Modify: `crosshash/crates/crosshash-parser/src/rust_extractor.rs`

- [ ] **Step 1: Add static edge extraction function**

Append to `rust_extractor.rs`:

```rust
use chrono::Utc;
use crosshash_core::{Edge, EdgeKind, EdgeSource};
use std::collections::HashMap;

pub fn extract_static_edges(entities: &[Entity], source_by_file: &HashMap<String, String>) -> Vec<Edge> {
    let mut edges = Vec::new();
    let by_name: HashMap<&str, &Entity> = entities.iter().map(|e| (e.name.as_str(), e)).collect();

    for source in entities {
        if !matches!(source.kind, EntityKind::Function | EntityKind::Method) {
            continue;
        }
        let Some(file_source) = source_by_file.get(&source.file_path) else {
            continue;
        };
        let body = &file_source[source.start_byte as usize..source.end_byte as usize];
        for target in entities {
            if source.id == target.id {
                continue;
            }
            let call_pattern = format!("{}(", target.name);
            if body.contains(&call_pattern) {
                edges.push(Edge {
                    id: Uuid::new_v5(&source.id, format!("calls:{}", target.id).as_bytes()),
                    source_entity_id: source.id,
                    target_entity_id: target.id,
                    kind: EdgeKind::Calls,
                    confidence: 0.8,
                    source: EdgeSource::Static,
                    metadata: None,
                    created_at: Utc::now(),
                    validated_at: None,
                });
            }
        }
    }

    for entity in entities {
        if let Some(parent_name) = entity.qualified_name.rsplit_once("::").map(|(p, _)| p.rsplit("::").next().unwrap_or(p)) {
            if let Some(parent) = by_name.get(parent_name) {
                edges.push(Edge {
                    id: Uuid::new_v5(&parent.id, format!("contains:{}", entity.id).as_bytes()),
                    source_entity_id: parent.id,
                    target_entity_id: entity.id,
                    kind: EdgeKind::Contains,
                    confidence: 1.0,
                    source: EdgeSource::Static,
                    metadata: None,
                    created_at: Utc::now(),
                    validated_at: None,
                });
            }
        }
    }

    edges
}
```

- [ ] **Step 2: Add edge extraction test**

Append to `rust_extractor.rs` tests module:

```rust
    #[test]
    fn extracts_call_edges_by_name_pattern() {
        let source = "fn a() { b(); } fn b() {}";
        let parsed = parse_rust_source(source).unwrap();
        let repo_id = Uuid::now_v7();
        let entities = extract_rust_entities(
            repo_id,
            Path::new("/repo"),
            Path::new("/repo/src/lib.rs"),
            source,
            &parsed.tree,
            "HEAD",
        );
        let mut source_by_file = std::collections::HashMap::new();
        source_by_file.insert("src/lib.rs".to_string(), source.to_string());
        let edges = extract_static_edges(&entities, &source_by_file);
        assert!(edges.iter().any(|e| e.kind == EdgeKind::Calls));
    }
```

- [ ] **Step 3: Run tests**

```bash
cd crosshash
cargo test -p crosshash-parser extracts_call_edges_by_name_pattern
```

Expected: call edge extraction test passes.

- [ ] **Step 4: Commit**

```bash
git add crosshash/crates/crosshash-parser/src/rust_extractor.rs
git commit -m "feat(crosshash-parser): extract basic Rust call edges"
```

---

## Task 9: CLI Skeleton and Repository Commands

**Files:**
- Modify: `crosshash/crates/crosshash-cli/src/main.rs`
- Create/modify: `crosshash/crates/crosshash-cli/src/commands.rs`
- Create/modify: `crosshash/crates/crosshash-cli/src/output.rs`
- Create/modify: `crosshash/crates/crosshash-cli/src/progress.rs`

- [ ] **Step 1: Implement CLI parser and dispatch**

Write `crosshash/crates/crosshash-cli/src/main.rs`:

```rust
mod commands;
mod output;
mod progress;

use clap::{Parser, Subcommand, ValueEnum};
use std::path::PathBuf;

#[derive(Debug, Parser)]
#[command(name = "crosshash")]
#[command(about = "Structural impact analysis for code graphs")]
pub struct Cli {
    #[arg(long, default_value = ".crosshash.db")]
    pub db: PathBuf,

    #[arg(long, value_enum, default_value_t = OutputFormat::Text)]
    pub format: OutputFormat,

    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
pub enum OutputFormat {
    Text,
    Json,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    Repo {
        #[command(subcommand)]
        command: RepoCommand,
    },
    Index {
        #[arg(long)]
        repo: String,
    },
    Entity {
        #[command(subcommand)]
        command: EntityCommand,
    },
    Graph {
        #[command(subcommand)]
        command: GraphCommand,
    },
}

#[derive(Debug, Subcommand)]
pub enum RepoCommand {
    Add {
        path: PathBuf,
        #[arg(long)]
        name: String,
    },
    List,
}

#[derive(Debug, Subcommand)]
pub enum EntityCommand {
    Lookup {
        name: String,
        #[arg(long)]
        repo: String,
    },
}

#[derive(Debug, Subcommand)]
pub enum GraphCommand {
    Callers {
        name: String,
        #[arg(long)]
        repo: String,
        #[arg(long, default_value_t = 2)]
        depth: usize,
    },
    Callees {
        name: String,
        #[arg(long)]
        repo: String,
        #[arg(long, default_value_t = 2)]
        depth: usize,
    },
    BlastRadius {
        name: String,
        #[arg(long)]
        repo: String,
    },
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    commands::run(cli)
}
```

- [ ] **Step 2: Implement repo add/list commands**

Write `crosshash/crates/crosshash-cli/src/commands.rs`:

```rust
use crate::{Cli, Command, EntityCommand, GraphCommand, RepoCommand};
use chrono::Utc;
use crosshash_core::{Language, Repo, WorkspaceType};
use crosshash_graph::storage::GraphStorage;
use std::path::Path;
use uuid::Uuid;

pub fn run(cli: Cli) -> anyhow::Result<()> {
    let storage = GraphStorage::open(&cli.db)?;
    match cli.command {
        Command::Repo { command } => run_repo(command, &storage),
        Command::Index { repo } => run_index(&repo, &storage),
        Command::Entity { command } => run_entity(command, &storage),
        Command::Graph { command } => run_graph(command, &storage),
    }
}

fn run_repo(command: RepoCommand, storage: &GraphStorage) -> anyhow::Result<()> {
    match command {
        RepoCommand::Add { path, name } => {
            let repo = Repo {
                id: Uuid::new_v5(&Uuid::NAMESPACE_URL, path.to_string_lossy().as_bytes()),
                name,
                root_path: path.canonicalize()?.to_string_lossy().to_string(),
                git_remote: None,
                default_branch: "main".to_string(),
                languages: vec![Language::Rust],
                workspace_type: detect_workspace_type(&path),
                last_indexed_at: Utc::now(),
                commit_hash: "HEAD".to_string(),
            };
            storage.insert_repo(&repo)?;
            println!("registered repo '{}' at {}", repo.name, repo.root_path);
            Ok(())
        }
        RepoCommand::List => {
            for repo in storage.list_repos()? {
                println!("{}\t{}", repo.name, repo.root_path);
            }
            Ok(())
        }
    }
}

fn detect_workspace_type(path: &Path) -> WorkspaceType {
    if path.join("Cargo.toml").exists() {
        WorkspaceType::CargoWorkspace
    } else {
        WorkspaceType::None
    }
}

fn run_index(_repo: &str, _storage: &GraphStorage) -> anyhow::Result<()> {
    anyhow::bail!("index command is implemented in Task 10")
}

fn run_entity(_command: EntityCommand, _storage: &GraphStorage) -> anyhow::Result<()> {
    anyhow::bail!("entity commands are implemented in Task 11")
}

fn run_graph(_command: GraphCommand, _storage: &GraphStorage) -> anyhow::Result<()> {
    anyhow::bail!("graph commands are implemented in Task 12")
}
```

- [ ] **Step 3: Add minimal output/progress modules**

Write `crosshash/crates/crosshash-cli/src/output.rs`:

```rust
pub fn print_json<T: serde::Serialize>(value: &T) -> anyhow::Result<()> {
    println!("{}", serde_json::to_string_pretty(value)?);
    Ok(())
}
```

Write `crosshash/crates/crosshash-cli/src/progress.rs`:

```rust
use indicatif::{ProgressBar, ProgressStyle};

pub fn spinner(message: &str) -> ProgressBar {
    let pb = ProgressBar::new_spinner();
    pb.set_message(message.to_string());
    pb.set_style(ProgressStyle::with_template("{spinner} {msg}").unwrap());
    pb
}
```

- [ ] **Step 4: Run CLI help**

```bash
cd crosshash
cargo run -p crosshash -- --help
cargo run -p crosshash -- repo --help
```

Expected: help text lists `repo`, `index`, `entity`, and `graph` commands.

- [ ] **Step 5: Commit**

```bash
git add crosshash/crates/crosshash-cli
git commit -m "feat(crosshash-cli): add CLI skeleton and repo commands"
```

---

## Task 10: End-to-End Index Command

**Files:**
- Modify: `crosshash/crates/crosshash-cli/src/commands.rs`
- Modify: `crosshash/crates/crosshash-graph/src/storage.rs` if additional CRUD helper is needed.

- [ ] **Step 1: Implement `run_index`**

Replace `run_index` in `commands.rs` with:

```rust
fn run_index(repo_name: &str, storage: &GraphStorage) -> anyhow::Result<()> {
    use crosshash_parser::ignore::collect_rust_files;
    use crosshash_parser::parser::parse_rust_file;
    use crosshash_parser::rust_extractor::{extract_rust_entities, extract_static_edges};
    use std::collections::HashMap;
    use std::fs;
    use std::path::PathBuf;

    let repo = storage
        .get_repo_by_name(repo_name)?
        .ok_or_else(|| anyhow::anyhow!("repo not found: {repo_name}"))?;
    let root = PathBuf::from(&repo.root_path);
    let files = collect_rust_files(&root)?;
    let mut all_entities = Vec::new();
    let mut source_by_file = HashMap::new();

    for file in files {
        let parsed = parse_rust_file(&file)?;
        let relative = file.strip_prefix(&root).unwrap_or(&file).to_string_lossy().to_string();
        source_by_file.insert(relative, parsed.source.clone());
        let entities = extract_rust_entities(
            repo.id,
            &root,
            &file,
            &parsed.source,
            &parsed.tree,
            &repo.commit_hash,
        );
        all_entities.extend(entities);
        let file_hash = crosshash_hash::hash_bytes(parsed.source.as_bytes());
        let relative = file.strip_prefix(&root).unwrap_or(&file).to_string_lossy().to_string();
        storage.upsert_file_hash(repo.id, &relative, &file_hash)?;
    }

    for entity in &all_entities {
        storage.insert_entity(entity)?;
        storage.insert_entity_version(&crosshash_core::EntityVersion {
            entity_id: entity.id,
            commit_hash: repo.commit_hash.clone(),
            name: entity.name.clone(),
            qualified_name: entity.qualified_name.clone(),
            signature: entity.signature.clone(),
            signature_hash: entity.signature_hash,
            content_hash: entity.content_hash,
            structural_hash: entity.structural_hash,
            identity_hash: entity.identity_hash,
            context_hash: entity.context_hash,
            snapshot_at: chrono::Utc::now(),
        })?;
    }

    let edges = extract_static_edges(&all_entities, &source_by_file);
    for edge in &edges {
        storage.insert_edge(edge)?;
    }

    println!(
        "indexed repo '{}' ({} entities, {} edges)",
        repo.name,
        all_entities.len(),
        edges.len()
    );
    Ok(())
}
```

- [ ] **Step 2: Add missing CLI dependency**

Add to `crosshash/crates/crosshash-cli/Cargo.toml` dependencies:

```toml
chrono.workspace = true
crosshash-hash = { path = "../crosshash-hash" }
```

- [ ] **Step 3: Run an end-to-end manual test**

```bash
cd crosshash
repo_dir=$(mktemp -d)
mkdir -p "$repo_dir/src"
printf 'pub fn a() { b(); }\nfn b() {}\n' > "$repo_dir/src/lib.rs"
cargo run -p crosshash -- --db "$repo_dir/crosshash.db" repo add "$repo_dir" --name demo
cargo run -p crosshash -- --db "$repo_dir/crosshash.db" index --repo demo
```

Expected output includes:

```text
registered repo 'demo'
indexed repo 'demo' (2 entities, 1 edges)
```

- [ ] **Step 4: Commit**

```bash
git add crosshash/crates/crosshash-cli
git commit -m "feat(crosshash-cli): index Rust repositories"
```

---

## Task 11: Entity Lookup Command

**Files:**
- Modify: `crosshash/crates/crosshash-cli/src/commands.rs`

- [ ] **Step 1: Implement `run_entity`**

Replace `run_entity` in `commands.rs` with:

```rust
fn run_entity(command: EntityCommand, storage: &GraphStorage) -> anyhow::Result<()> {
    match command {
        EntityCommand::Lookup { name, repo } => {
            let repo = storage
                .get_repo_by_name(&repo)?
                .ok_or_else(|| anyhow::anyhow!("repo not found: {repo}"))?;
            let entities = storage.get_entities_by_name(&name, Some(repo.id))?;
            if entities.is_empty() {
                anyhow::bail!("entity not found: {name}");
            }
            for entity in entities {
                println!(
                    "{}\t{:?}\t{}:{}-{}",
                    entity.qualified_name,
                    entity.kind,
                    entity.file_path,
                    entity.start_line,
                    entity.end_line
                );
            }
            Ok(())
        }
    }
}
```

- [ ] **Step 2: Manual test lookup**

```bash
cd crosshash
repo_dir=$(mktemp -d)
mkdir -p "$repo_dir/src"
printf 'pub fn a() { b(); }\nfn b() {}\n' > "$repo_dir/src/lib.rs"
cargo run -p crosshash -- --db "$repo_dir/crosshash.db" repo add "$repo_dir" --name demo
cargo run -p crosshash -- --db "$repo_dir/crosshash.db" index --repo demo
cargo run -p crosshash -- --db "$repo_dir/crosshash.db" entity lookup a --repo demo
```

Expected output includes:

```text
a	Function	src/lib.rs:1-1
```

- [ ] **Step 3: Commit**

```bash
git add crosshash/crates/crosshash-cli/src/commands.rs
git commit -m "feat(crosshash-cli): look up indexed entities"
```

---

## Task 12: Graph Query Commands

**Files:**
- Modify: `crosshash/crates/crosshash-cli/src/commands.rs`

- [ ] **Step 1: Implement `run_graph`**

Replace `run_graph` in `commands.rs` with:

```rust
fn run_graph(command: GraphCommand, storage: &GraphStorage) -> anyhow::Result<()> {
    use crosshash_graph::builder::GraphBuilder;
    use crosshash_graph::traversal::GraphTraversal;

    let (name, repo_name, mode, depth) = match command {
        GraphCommand::Callers { name, repo, depth } => (name, repo, "callers", Some(depth)),
        GraphCommand::Callees { name, repo, depth } => (name, repo, "callees", Some(depth)),
        GraphCommand::BlastRadius { name, repo } => (name, repo, "blast-radius", None),
    };

    let repo = storage
        .get_repo_by_name(&repo_name)?
        .ok_or_else(|| anyhow::anyhow!("repo not found: {repo_name}"))?;
    let entities = storage.get_entities_by_name(&name, Some(repo.id))?;
    let entity = entities
        .first()
        .ok_or_else(|| anyhow::anyhow!("entity not found: {name}"))?;
    let graph = GraphBuilder::build_for_repo(storage, repo.id)?;
    let traversal = GraphTraversal::new(&graph);
    let hits = match mode {
        "callers" => traversal.callers(entity.id, depth.unwrap_or(2))?,
        "callees" => traversal.callees(entity.id, depth.unwrap_or(2))?,
        "blast-radius" => traversal.blast_radius(entity.id)?,
        _ => unreachable!(),
    };

    for hit in hits {
        println!("depth={}\t{}\t{}", hit.depth, hit.entity.qualified_name, hit.entity.file_path);
    }
    Ok(())
}
```

- [ ] **Step 2: Manual test graph commands**

```bash
cd crosshash
repo_dir=$(mktemp -d)
mkdir -p "$repo_dir/src"
printf 'pub fn a() { b(); }\nfn b() {}\n' > "$repo_dir/src/lib.rs"
cargo run -p crosshash -- --db "$repo_dir/crosshash.db" repo add "$repo_dir" --name demo
cargo run -p crosshash -- --db "$repo_dir/crosshash.db" index --repo demo
cargo run -p crosshash -- --db "$repo_dir/crosshash.db" graph callers b --repo demo --depth 1
cargo run -p crosshash -- --db "$repo_dir/crosshash.db" graph callees a --repo demo --depth 1
cargo run -p crosshash -- --db "$repo_dir/crosshash.db" graph blast-radius b --repo demo
```

Expected outputs include `a` as caller of `b`, `b` as callee of `a`, and `a` in `blast-radius b`.

- [ ] **Step 3: Commit**

```bash
git add crosshash/crates/crosshash-cli/src/commands.rs
git commit -m "feat(crosshash-cli): query entity dependency graph"
```

---

## Task 13: CI and Final Verification

**Files:**
- Create: `crosshash/.github/workflows/ci.yml`

- [ ] **Step 1: Add CI workflow**

Create `crosshash/.github/workflows/ci.yml`:

```yaml
name: CrossHash CI

on:
  push:
    paths:
      - 'crosshash/**'
  pull_request:
    paths:
      - 'crosshash/**'

jobs:
  test:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: crosshash
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: rustfmt, clippy
      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: crosshash
      - run: cargo fmt --check
      - run: cargo clippy --workspace --all-targets -- -D warnings
      - run: cargo test --workspace
      - run: cargo build --workspace
```

- [ ] **Step 2: Run local verification**

```bash
cd crosshash
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo build --workspace
```

Expected: all commands pass.

- [ ] **Step 3: Run end-to-end smoke test**

```bash
cd crosshash
repo_dir=$(mktemp -d)
mkdir -p "$repo_dir/src"
printf 'pub fn entry() { helper(); }\nfn helper() {}\n' > "$repo_dir/src/lib.rs"
cargo run -p crosshash -- --db "$repo_dir/crosshash.db" repo add "$repo_dir" --name smoke
cargo run -p crosshash -- --db "$repo_dir/crosshash.db" index --repo smoke
cargo run -p crosshash -- --db "$repo_dir/crosshash.db" entity lookup entry --repo smoke
cargo run -p crosshash -- --db "$repo_dir/crosshash.db" graph callers helper --repo smoke --depth 1
```

Expected: `entry` is found, and `entry` appears as a caller of `helper`.

- [ ] **Step 4: Commit**

```bash
git add crosshash/.github/workflows/ci.yml
git commit -m "ci(crosshash): verify workspace build and tests"
```

---

## Success Criteria for v0.1

- `cargo build --workspace` succeeds from `crosshash/`.
- `cargo test --workspace` passes.
- Existing `storage.rs` compiles and tests pass.
- `crosshash --help` shows planned commands.
- `repo add`, `repo list`, `index`, `entity lookup`, `graph callers`, `graph callees`, and `graph blast-radius` work against a small Rust fixture repo.
- Static query runtime is zero-AI and works entirely from SQLite + petgraph.

---

## Self-Review

### Spec coverage

- Phase 0 scaffolding: covered by Tasks 1, 2, 3, 9, 13.
- Phase 1 parser + hasher: covered by Tasks 4, 5, 6, 8, 10.
- Phase 2 intra-repo graph: covered by Tasks 7, 8, 12.

### Intentional gaps

- Git operations and incremental indexing are deferred because v0.1 focuses on a working single-repo static graph loop. They belong in v0.2 before impact diffing.
- TypeScript/Python are deferred to avoid tripling extractor complexity before the graph path is validated.
- Import resolution is minimal in v0.1; robust Rust path resolution should be a separate follow-up after basic graph traversal works.

### Type consistency

- All types referenced by the existing `storage.rs` are defined in `crosshash-core`.
- Edge direction remains `source -> target = source depends on target`.
- Traversal uses incoming edges for callers/blast radius and outgoing edges for callees.
