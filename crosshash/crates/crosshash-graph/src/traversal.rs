use crosshash_core::{Edge, Entity};
use petgraph::algo::{astar, kosaraju_scc, toposort};
use petgraph::graph::{DiGraph, NodeIndex};
use petgraph::visit::EdgeRef;
use std::collections::{HashMap, HashSet, VecDeque};
use uuid::Uuid;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EdgeStep {
    pub source_entity_id: Uuid,
    pub target_entity_id: Uuid,
    pub edge: Edge,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TraversalHit {
    pub entity: Entity,
    pub distance: usize,
    pub path: Vec<EdgeStep>,
}

#[derive(Debug, Clone)]
pub struct DependencyGraph {
    pub graph: DiGraph<Entity, Edge>,
    pub id_to_index: HashMap<Uuid, NodeIndex>,
}

pub struct GraphTraversal<'a> {
    dependency_graph: &'a DependencyGraph,
}

impl<'a> GraphTraversal<'a> {
    pub fn new(dependency_graph: &'a DependencyGraph) -> Self {
        Self { dependency_graph }
    }

    pub fn callers(&self, entity_id: Uuid, depth: usize) -> Vec<TraversalHit> {
        self.bfs(entity_id, depth, Direction::Reverse)
    }

    pub fn callees(&self, entity_id: Uuid, depth: usize) -> Vec<TraversalHit> {
        self.bfs(entity_id, depth, Direction::Forward)
    }

    pub fn blast_radius(&self, entity_id: Uuid) -> Vec<TraversalHit> {
        self.bfs(entity_id, usize::MAX, Direction::Reverse)
    }

    pub fn path_between(&self, source_id: Uuid, target_id: Uuid) -> Option<Vec<EdgeStep>> {
        let source = *self.dependency_graph.id_to_index.get(&source_id)?;
        let target = *self.dependency_graph.id_to_index.get(&target_id)?;
        let (_, nodes) = astar(
            &self.dependency_graph.graph,
            source,
            |node| node == target,
            |_| 1usize,
            |_| 0usize,
        )?;
        Some(
            nodes
                .windows(2)
                .filter_map(|pair| self.step_between(pair[0], pair[1]))
                .collect(),
        )
    }

    pub fn topological_sort(&self) -> Result<Vec<Entity>, Vec<Vec<Entity>>> {
        match toposort(&self.dependency_graph.graph, None) {
            Ok(nodes) => Ok(nodes
                .into_iter()
                .map(|n| self.dependency_graph.graph[n].clone())
                .collect()),
            Err(_) => Err(self.detect_cycles()),
        }
    }

    pub fn detect_cycles(&self) -> Vec<Vec<Entity>> {
        let sccs = kosaraju_scc(&self.dependency_graph.graph)
            .into_iter()
            .filter(|component| component.len() > 1)
            .map(|component| {
                component
                    .into_iter()
                    .map(|n| self.dependency_graph.graph[n].clone())
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>();
        for cycle in &sccs {
            let names: Vec<String> = cycle.iter().map(|e| e.qualified_name.clone()).collect();
            log::warn!("cycle detected: {}", names.join(" -> "));
        }
        sccs
    }

    fn bfs(&self, entity_id: Uuid, max_depth: usize, direction: Direction) -> Vec<TraversalHit> {
        let Some(start) = self.dependency_graph.id_to_index.get(&entity_id).copied() else {
            return Vec::new();
        };
        let mut visited = HashSet::from([start]);
        let mut queue = VecDeque::from([(start, 0usize, Vec::<EdgeStep>::new())]);
        let mut hits = Vec::new();

        while let Some((node, distance, path)) = queue.pop_front() {
            if distance >= max_depth {
                continue;
            }
            for edge_ref in self.edges(node, direction) {
                let next = match direction {
                    Direction::Forward => edge_ref.target(),
                    Direction::Reverse => edge_ref.source(),
                };
                if !visited.insert(next) {
                    continue;
                }
                let mut next_path = path.clone();
                next_path.push(EdgeStep {
                    source_entity_id: self.dependency_graph.graph[edge_ref.source()].id,
                    target_entity_id: self.dependency_graph.graph[edge_ref.target()].id,
                    edge: edge_ref.weight().clone(),
                });
                hits.push(TraversalHit {
                    entity: self.dependency_graph.graph[next].clone(),
                    distance: distance + 1,
                    path: next_path.clone(),
                });
                queue.push_back((next, distance + 1, next_path));
            }
        }

        hits
    }

    fn edges(
        &self,
        node: NodeIndex,
        direction: Direction,
    ) -> Vec<petgraph::graph::EdgeReference<'_, Edge>> {
        match direction {
            Direction::Forward => self
                .dependency_graph
                .graph
                .edges_directed(node, petgraph::Direction::Outgoing)
                .collect(),
            Direction::Reverse => self
                .dependency_graph
                .graph
                .edges_directed(node, petgraph::Direction::Incoming)
                .collect(),
        }
    }

    fn step_between(&self, source: NodeIndex, target: NodeIndex) -> Option<EdgeStep> {
        let edge = self
            .dependency_graph
            .graph
            .edges_connecting(source, target)
            .next()?;
        Some(EdgeStep {
            source_entity_id: self.dependency_graph.graph[source].id,
            target_entity_id: self.dependency_graph.graph[target].id,
            edge: edge.weight().clone(),
        })
    }
}

#[derive(Debug, Clone, Copy)]
enum Direction {
    Forward,
    Reverse,
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

    fn graph() -> DependencyGraph {
        let a = entity("a");
        let b = entity("b");
        let c = entity("c");
        let mut graph = DiGraph::new();
        let ai = graph.add_node(a.clone());
        let bi = graph.add_node(b.clone());
        let ci = graph.add_node(c.clone());
        graph.add_edge(ai, bi, edge(a.id, b.id));
        graph.add_edge(bi, ci, edge(b.id, c.id));
        graph.add_edge(ci, ai, edge(c.id, a.id));
        DependencyGraph {
            graph,
            id_to_index: [(a.id, ai), (b.id, bi), (c.id, ci)].into_iter().collect(),
        }
    }

    #[test]
    fn callers_follow_reverse_edges_without_looping_on_cycles() {
        let graph = graph();
        let traversal = GraphTraversal::new(&graph);
        let b = Uuid::new_v5(&Uuid::NAMESPACE_OID, b"b");
        let callers = traversal.callers(b, 10);
        assert_eq!(callers.len(), 2);
        assert_eq!(callers[0].entity.name, "a");
    }

    #[test]
    fn callees_follow_forward_edges() {
        let graph = graph();
        let traversal = GraphTraversal::new(&graph);
        let b = Uuid::new_v5(&Uuid::NAMESPACE_OID, b"b");
        let callees = traversal.callees(b, 1);
        assert_eq!(callees.len(), 1);
        assert_eq!(callees[0].entity.name, "c");
    }

    #[test]
    fn detects_cycles() {
        let graph = graph();
        let cycles = GraphTraversal::new(&graph).detect_cycles();
        assert_eq!(cycles.len(), 1);
        assert_eq!(cycles[0].len(), 3);
    }
}
