use crate::storage::GraphStorage;
use crate::traversal::DependencyGraph;
use crosshash_core::{CoreError, Edge, Entity, Result};
use petgraph::graph::DiGraph;
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GraphMetrics {
    pub nodes: usize,
    pub edges: usize,
    pub max_in_degree: usize,
    pub max_out_degree: usize,
    pub strongly_connected_components: usize,
}

pub struct GraphBuilder;

impl GraphBuilder {
    pub fn from_storage(storage: &GraphStorage, repo_id: Uuid) -> Result<DependencyGraph> {
        let entities = storage.get_entities_by_repo(repo_id)?;
        let entity_ids = entities.iter().map(|e| e.id).collect::<HashSet<_>>();
        let edges = storage
            .get_edges_by_repo(repo_id)?
            .into_iter()
            .filter(|edge| {
                entity_ids.contains(&edge.source_entity_id)
                    && entity_ids.contains(&edge.target_entity_id)
            })
            .collect::<Vec<_>>();
        Self::from_parts(entities, edges)
    }

    pub fn from_all_repos(storage: &GraphStorage) -> Result<DependencyGraph> {
        let entities = storage.get_entities_all()?;
        let edges = storage.get_edges_all()?;
        Self::from_parts(entities, edges)
    }

    pub fn from_repos(storage: &GraphStorage, repo_ids: &[Uuid]) -> Result<DependencyGraph> {
        let wanted = repo_ids.iter().copied().collect::<HashSet<_>>();
        let entities = storage
            .get_entities_all()?
            .into_iter()
            .filter(|entity| wanted.contains(&entity.repo_id))
            .collect::<Vec<_>>();
        let entity_ids = entities.iter().map(|e| e.id).collect::<HashSet<_>>();
        let edges = storage
            .get_edges_all()?
            .into_iter()
            .filter(|edge| {
                entity_ids.contains(&edge.source_entity_id)
                    && entity_ids.contains(&edge.target_entity_id)
            })
            .collect::<Vec<_>>();
        Self::from_parts(entities, edges)
    }

    pub fn from_parts(entities: Vec<Entity>, edges: Vec<Edge>) -> Result<DependencyGraph> {
        let entity_ids = entities.iter().map(|e| e.id).collect::<HashSet<_>>();
        for edge in &edges {
            if !entity_ids.contains(&edge.source_entity_id)
                || !entity_ids.contains(&edge.target_entity_id)
            {
                return Err(CoreError::StorageError(format!(
                    "orphan edge {} references {} -> {}",
                    edge.id, edge.source_entity_id, edge.target_entity_id
                )));
            }
        }

        let mut graph = DiGraph::new();
        let mut id_to_index = HashMap::new();
        for entity in entities {
            let id = entity.id;
            let index = graph.add_node(entity);
            id_to_index.insert(id, index);
        }
        for edge in edges {
            let source = id_to_index[&edge.source_entity_id];
            let target = id_to_index[&edge.target_entity_id];
            graph.add_edge(source, target, edge);
        }
        Ok(DependencyGraph { graph, id_to_index })
    }

    pub fn metrics(graph: &DependencyGraph) -> GraphMetrics {
        let max_in_degree = graph
            .graph
            .node_indices()
            .map(|node| {
                graph
                    .graph
                    .edges_directed(node, petgraph::Direction::Incoming)
                    .count()
            })
            .max()
            .unwrap_or(0);
        let max_out_degree = graph
            .graph
            .node_indices()
            .map(|node| {
                graph
                    .graph
                    .edges_directed(node, petgraph::Direction::Outgoing)
                    .count()
            })
            .max()
            .unwrap_or(0);
        GraphMetrics {
            nodes: graph.graph.node_count(),
            edges: graph.graph.edge_count(),
            max_in_degree,
            max_out_degree,
            strongly_connected_components: petgraph::algo::kosaraju_scc(&graph.graph).len(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crosshash_core::{EdgeKind, EdgeSource, EntityKind, Language, Visibility};

    fn entity(name: &str) -> Entity {
        Entity {
            id: Uuid::new_v5(&Uuid::NAMESPACE_OID, name.as_bytes()),
            repo_id: Uuid::NAMESPACE_DNS,
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
            visibility: Visibility::Private,
            is_exported: false,
            is_async: false,
            is_test: false,
            first_seen_commit: "a".into(),
            last_seen_commit: "a".into(),
            deleted_at_commit: None,
        }
    }

    fn edge(source: Uuid, target: Uuid) -> Edge {
        Edge {
            id: Uuid::new_v5(&source, target.as_bytes()),
            source_entity_id: source,
            target_entity_id: target,
            kind: EdgeKind::Calls,
            confidence: 1.0,
            source: EdgeSource::Static,
            metadata: None,
            created_at: chrono::Utc::now(),
            validated_at: None,
        }
    }

    #[test]
    fn builds_graph_and_metrics_from_entities_and_edges() {
        let a = entity("a");
        let b = entity("b");
        let graph =
            GraphBuilder::from_parts(vec![a.clone(), b.clone()], vec![edge(a.id, b.id)]).unwrap();
        let metrics = GraphBuilder::metrics(&graph);
        assert_eq!(metrics.nodes, 2);
        assert_eq!(metrics.edges, 1);
        assert_eq!(metrics.max_out_degree, 1);
        assert_eq!(metrics.max_in_degree, 1);
    }

    #[test]
    fn rejects_orphan_edges() {
        let a = entity("a");
        let b = entity("b");
        let err = GraphBuilder::from_parts(vec![a.clone()], vec![edge(a.id, b.id)]).unwrap_err();
        assert!(err.to_string().contains("orphan edge"));
    }
}
