use crate::storage::GraphStorage;
use crosshash_core::{Edge, Result};
use std::collections::HashSet;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq)]
pub struct EdgeValidationReport {
    pub valid_edges: usize,
    pub stale_edges: Vec<Edge>,
}

pub fn validate_edges_for_repo(
    storage: &GraphStorage,
    repo_id: Uuid,
) -> Result<EdgeValidationReport> {
    let repo_edges = storage.get_edges_by_repo(repo_id)?;
    let entities = storage.get_entities_all()?;
    let live_ids = entities.into_iter().map(|e| e.id).collect::<HashSet<_>>();
    let mut report = EdgeValidationReport {
        valid_edges: 0,
        stale_edges: Vec::new(),
    };

    for edge in repo_edges {
        if live_ids.contains(&edge.source_entity_id) && live_ids.contains(&edge.target_entity_id) {
            report.valid_edges += 1;
        } else {
            report.stale_edges.push(edge);
        }
    }

    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crosshash_core::{
        EdgeKind, EdgeSource, Entity, EntityKind, Language, Repo, Visibility, WorkspaceType,
    };

    fn repo(name: &str) -> Repo {
        Repo {
            id: Uuid::new_v5(&Uuid::NAMESPACE_DNS, name.as_bytes()),
            name: name.into(),
            root_path: "/tmp/x".into(),
            git_remote: None,
            default_branch: "main".into(),
            languages: vec![Language::Rust],
            workspace_type: WorkspaceType::None,
            last_indexed_at: chrono::Utc::now(),
            commit_hash: "a".into(),
        }
    }

    fn entity(repo_id: Uuid, name: &str) -> Entity {
        Entity {
            id: Uuid::new_v5(&repo_id, name.as_bytes()),
            repo_id,
            file_path: "src/lib.rs".into(),
            language: Language::Rust,
            kind: EntityKind::Function,
            name: name.into(),
            qualified_name: name.into(),
            signature: format!("fn {name}()"),
            start_line: 1,
            end_line: 1,
            start_byte: 0,
            end_byte: 1,
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
        }
    }

    #[test]
    fn reports_stale_edges_when_target_deleted() {
        let storage = GraphStorage::open_in_memory().unwrap();
        let repo = repo("r");
        storage.insert_repo(&repo).unwrap();
        let a = entity(repo.id, "a");
        let b = entity(repo.id, "b");
        storage.insert_entity(&a).unwrap();
        storage.insert_entity(&b).unwrap();
        storage
            .insert_edge(&Edge {
                id: Uuid::now_v7(),
                source_entity_id: a.id,
                target_entity_id: b.id,
                kind: EdgeKind::Calls,
                confidence: 1.0,
                source: EdgeSource::Static,
                metadata: None,
                created_at: chrono::Utc::now(),
                validated_at: None,
            })
            .unwrap();
        storage
            .mark_entities_deleted(repo.id, &[b.id], "b")
            .unwrap();

        let report = validate_edges_for_repo(&storage, repo.id).unwrap();
        assert_eq!(report.valid_edges, 0);
        assert_eq!(report.stale_edges.len(), 1);
    }
}
