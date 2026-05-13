use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub type Hash32 = [u8; 32];
pub type CommitHash = String;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Language {
    Rust,
    TypeScript,
    JavaScript,
    Python,
    Go,
    Java,
    C,
    Cpp,
    CSharp,
    Ruby,
    Php,
    Swift,
    Kotlin,
    Scala,
    Elixir,
    Dart,
    Ocaml,
    Zig,
    Bash,
    Html,
    Css,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum EntityKind {
    Function,
    Method,
    Struct,
    Enum,
    Trait,
    Impl,
    Module,
    Constant,
    TypeAlias,
    Class,
    Interface,
    Field,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum EdgeKind {
    Calls,
    Imports,
    Contains,
    Extends,
    Implements,
    TypeReferences,
    Uses,
    PackageDep,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EdgeSource {
    Static,
    AiInferred,
    UserFeedback,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Visibility {
    Public,
    Private,
    Protected,
    Internal,
    Crate,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ChangeType {
    Added,
    Modified,
    Deleted,
    Moved,
    Renamed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ImpactType {
    Direct,
    Transitive,
    SignatureBreaking,
    Behavioral,
    Structural,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RiskLevel {
    Low,
    Medium,
    High,
    Critical,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum WorkspaceType {
    None,
    Cargo,
    Npm,
    Yarn,
    Pnpm,
    Nx,
    Bazel,
    GoModules,
    Turborepo,
    CargoWorkspace,
    NpmWorkspace,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EntityHashes {
    pub signature_hash: Hash32,
    pub content_hash: Hash32,
    pub structural_hash: Hash32,
    pub identity_hash: Hash32,
    pub context_hash: Hash32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileDiff {
    pub path: String,
    pub old_path: Option<String>,
    pub change_type: ChangeType,
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
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

impl Entity {
    pub fn hashes(&self) -> EntityHashes {
        EntityHashes {
            signature_hash: self.signature_hash,
            content_hash: self.content_hash,
            structural_hash: self.structural_hash,
            identity_hash: self.identity_hash,
            context_hash: self.context_hash,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Edge {
    pub id: Uuid,
    pub source_entity_id: Uuid,
    pub target_entity_id: Uuid,
    pub kind: EdgeKind,
    pub confidence: f64,
    pub source: EdgeSource,
    pub metadata: Option<serde_json::Value>,
    pub created_at: DateTime<Utc>,
    pub validated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChangedEntity {
    pub entity_id: Uuid,
    pub change_type: ChangeType,
    pub old_hashes: Option<EntityHashes>,
    pub new_hashes: Option<EntityHashes>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ImpactedEntity {
    pub entity_id: Uuid,
    pub impact_type: ImpactType,
    pub risk: RiskLevel,
    pub distance: usize,
    pub path: Vec<Uuid>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ImpactReport {
    pub changed_repos: Vec<Uuid>,
    pub affected_repos: Vec<Uuid>,
    pub changed_entities: Vec<ChangedEntity>,
    pub impacted_entities: Vec<ImpactedEntity>,
    pub generated_at: DateTime<Utc>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entity_hashes_exposes_all_five_hashes() {
        let entity = Entity {
            id: Uuid::now_v7(),
            repo_id: Uuid::now_v7(),
            file_path: "src/lib.rs".into(),
            language: Language::Rust,
            kind: EntityKind::Function,
            name: "f".into(),
            qualified_name: "crate::f".into(),
            signature: "fn f()".into(),
            start_line: 1,
            end_line: 1,
            start_byte: 0,
            end_byte: 6,
            signature_hash: [1; 32],
            content_hash: [2; 32],
            structural_hash: [3; 32],
            identity_hash: [4; 32],
            context_hash: [5; 32],
            visibility: Visibility::Public,
            is_exported: true,
            is_async: false,
            is_test: false,
            first_seen_commit: "a".into(),
            last_seen_commit: "a".into(),
            deleted_at_commit: None,
        };

        let hashes = entity.hashes();
        assert_eq!(hashes.signature_hash, [1; 32]);
        assert_eq!(hashes.content_hash, [2; 32]);
        assert_eq!(hashes.structural_hash, [3; 32]);
        assert_eq!(hashes.identity_hash, [4; 32]);
        assert_eq!(hashes.context_hash, [5; 32]);
    }

    #[test]
    fn impact_report_supports_n_repos_not_pair_only() {
        let repo_a = Uuid::now_v7();
        let repo_b = Uuid::now_v7();
        let repo_c = Uuid::now_v7();
        let report = ImpactReport {
            changed_repos: vec![repo_a, repo_b],
            affected_repos: vec![repo_a, repo_b, repo_c],
            changed_entities: Vec::new(),
            impacted_entities: Vec::new(),
            generated_at: Utc::now(),
        };

        assert_eq!(report.changed_repos.len(), 2);
        assert_eq!(report.affected_repos.len(), 3);
    }
}
