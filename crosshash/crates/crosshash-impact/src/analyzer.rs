use crosshash_core::{Edge, Entity};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ImpactPathStep {
    pub source_entity_id: Uuid,
    pub target_entity_id: Uuid,
    pub edge_kind: String,
    pub confidence: f64,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AffectedEntity {
    pub entity_id: Uuid,
    pub distance: usize,
    pub min_confidence: f64,
    pub path: Vec<ImpactPathStep>,
}

pub struct ImpactAnalyzer {
    pub min_confidence: f64,
    pub max_depth: usize,
}
impl Default for ImpactAnalyzer {
    fn default() -> Self {
        Self {
            min_confidence: 0.5,
            max_depth: 8,
        }
    }
}

impl ImpactAnalyzer {
    pub fn analyze(
        &self,
        changed: &[Uuid],
        entities: &[Entity],
        edges: &[Edge],
    ) -> Vec<AffectedEntity> {
        let existing = entities.iter().map(|e| e.id).collect::<HashSet<_>>();
        let reverse = reverse_index(edges, self.min_confidence);
        let mut seen = changed.iter().copied().collect::<HashSet<_>>();
        let mut queue = VecDeque::new();
        for id in changed {
            queue.push_back((*id, 0usize, 1.0f64, Vec::new()));
        }
        let mut out = Vec::new();
        while let Some((current, depth, conf, path)) = queue.pop_front() {
            if depth >= self.max_depth {
                continue;
            }
            for edge in reverse.get(&current).into_iter().flatten() {
                let next = edge.source_entity_id;
                if !existing.contains(&next) || !seen.insert(next) {
                    continue;
                }
                let mut next_path = path.clone();
                next_path.push(ImpactPathStep {
                    source_entity_id: edge.source_entity_id,
                    target_entity_id: edge.target_entity_id,
                    edge_kind: format!("{:?}", edge.kind),
                    confidence: edge.confidence,
                });
                let min_conf = conf.min(edge.confidence);
                out.push(AffectedEntity {
                    entity_id: next,
                    distance: depth + 1,
                    min_confidence: min_conf,
                    path: next_path.clone(),
                });
                queue.push_back((next, depth + 1, min_conf, next_path));
            }
        }
        out
    }
}

fn reverse_index(edges: &[Edge], min_confidence: f64) -> HashMap<Uuid, Vec<Edge>> {
    let mut map: HashMap<Uuid, Vec<Edge>> = HashMap::new();
    for edge in edges.iter().filter(|e| e.confidence >= min_confidence) {
        map.entry(edge.target_entity_id)
            .or_default()
            .push(edge.clone());
    }
    map
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use crosshash_core::{EdgeKind, EdgeSource, EntityKind, Language, Visibility};

    fn entity(id: Uuid, repo_id: Uuid) -> Entity {
        Entity {
            id,
            repo_id,
            file_path: "src/lib.rs".into(),
            language: Language::Rust,
            kind: EntityKind::Function,
            name: format!("fn_{id}"),
            qualified_name: format!("fn_{id}"),
            signature: format!("fn fn_{id}()"),
            start_line: 1,
            end_line: 1,
            start_byte: 0,
            end_byte: 10,
            signature_hash: [0; 32],
            content_hash: [0; 32],
            structural_hash: [0; 32],
            identity_hash: [0; 32],
            context_hash: [0; 32],
            visibility: Visibility::Public,
            is_exported: true,
            is_async: false,
            is_test: false,
            first_seen_commit: "abc".into(),
            last_seen_commit: "abc".into(),
            deleted_at_commit: None,
        }
    }

    fn edge(source: Uuid, target: Uuid, kind: EdgeKind, confidence: f64) -> Edge {
        Edge {
            id: Uuid::now_v7(),
            source_entity_id: source,
            target_entity_id: target,
            kind,
            confidence,
            source: EdgeSource::Static,
            metadata: None,
            created_at: Utc::now(),
            validated_at: None,
        }
    }

    #[test]
    fn empty_input_returns_empty_output() {
        let analyzer = ImpactAnalyzer::default();
        let result = analyzer.analyze(&[], &[], &[]);
        assert!(result.is_empty());
    }

    #[test]
    fn bfs_finds_direct_callers() {
        let repo = Uuid::now_v7();
        let changed = Uuid::now_v7();
        let caller = Uuid::now_v7();
        let entities = vec![entity(changed, repo), entity(caller, repo)];
        let edges = vec![edge(caller, changed, EdgeKind::Calls, 1.0)];
        let analyzer = ImpactAnalyzer::default();
        let result = analyzer.analyze(&[changed], &entities, &edges);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].entity_id, caller);
        assert_eq!(result[0].distance, 1);
    }

    #[test]
    fn bfs_follows_transitive_call_chain() {
        let repo = Uuid::now_v7();
        let a = Uuid::now_v7();
        let b = Uuid::now_v7();
        let c = Uuid::now_v7();
        let entities = vec![entity(a, repo), entity(b, repo), entity(c, repo)];
        let edges = vec![
            edge(b, a, EdgeKind::Calls, 1.0),
            edge(c, b, EdgeKind::Calls, 1.0),
        ];
        let analyzer = ImpactAnalyzer::default();
        let result = analyzer.analyze(&[a], &entities, &edges);
        assert_eq!(result.len(), 2);
        let distances: Vec<usize> = result.iter().map(|r| r.distance).collect();
        assert!(distances.contains(&1));
        assert!(distances.contains(&2));
    }

    #[test]
    fn cycle_detection_prevents_infinite_loop() {
        let repo = Uuid::now_v7();
        let a = Uuid::now_v7();
        let b = Uuid::now_v7();
        let entities = vec![entity(a, repo), entity(b, repo)];
        let edges = vec![
            edge(b, a, EdgeKind::Calls, 1.0),
            edge(a, b, EdgeKind::Calls, 1.0),
        ];
        let analyzer = ImpactAnalyzer::default();
        let result = analyzer.analyze(&[a], &entities, &edges);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].entity_id, b);
    }

    #[test]
    fn min_confidence_filters_low_confidence_edges() {
        let repo = Uuid::now_v7();
        let changed = Uuid::now_v7();
        let high_caller = Uuid::now_v7();
        let low_caller = Uuid::now_v7();
        let entities = vec![
            entity(changed, repo),
            entity(high_caller, repo),
            entity(low_caller, repo),
        ];
        let edges = vec![
            edge(high_caller, changed, EdgeKind::Calls, 0.8),
            edge(low_caller, changed, EdgeKind::Calls, 0.3),
        ];
        let analyzer = ImpactAnalyzer {
            min_confidence: 0.5,
            max_depth: 8,
        };
        let result = analyzer.analyze(&[changed], &entities, &edges);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].entity_id, high_caller);
    }

    #[test]
    fn max_depth_limits_propagation() {
        let repo = Uuid::now_v7();
        let nodes: Vec<Uuid> = (0..5).map(|_| Uuid::now_v7()).collect();
        let entities: Vec<Entity> = nodes.iter().map(|&id| entity(id, repo)).collect();
        let edges: Vec<Edge> = (0..4)
            .map(|i| edge(nodes[i + 1], nodes[i], EdgeKind::Calls, 1.0))
            .collect();
        let analyzer = ImpactAnalyzer {
            min_confidence: 0.0,
            max_depth: 2,
        };
        let result = analyzer.analyze(&[nodes[0]], &entities, &edges);
        assert!(result.iter().all(|r| r.distance <= 2));
    }

    #[test]
    fn cross_repo_edges_traverse_boundaries() {
        let repo_a = Uuid::now_v7();
        let repo_b = Uuid::now_v7();
        let changed = Uuid::now_v7();
        let caller_in_b = Uuid::now_v7();
        let entities = vec![entity(changed, repo_a), entity(caller_in_b, repo_b)];
        let edges = vec![edge(caller_in_b, changed, EdgeKind::Imports, 0.9)];
        let analyzer = ImpactAnalyzer::default();
        let result = analyzer.analyze(&[changed], &entities, &edges);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].entity_id, caller_in_b);
    }

    #[test]
    fn tracks_min_confidence_along_path() {
        let repo = Uuid::now_v7();
        let a = Uuid::now_v7();
        let b = Uuid::now_v7();
        let c = Uuid::now_v7();
        let entities = vec![entity(a, repo), entity(b, repo), entity(c, repo)];
        let edges = vec![
            edge(b, a, EdgeKind::Calls, 0.9),
            edge(c, b, EdgeKind::Calls, 0.6),
        ];
        let analyzer = ImpactAnalyzer {
            min_confidence: 0.5,
            max_depth: 8,
        };
        let result = analyzer.analyze(&[a], &entities, &edges);
        let c_result = result.iter().find(|r| r.entity_id == c).unwrap();
        assert!((c_result.min_confidence - 0.6).abs() < f64::EPSILON);
    }

    #[test]
    fn impact_path_records_edge_chain() {
        let repo = Uuid::now_v7();
        let a = Uuid::now_v7();
        let b = Uuid::now_v7();
        let entities = vec![entity(a, repo), entity(b, repo)];
        let edges = vec![edge(b, a, EdgeKind::Extends, 0.8)];
        let analyzer = ImpactAnalyzer::default();
        let result = analyzer.analyze(&[a], &entities, &edges);
        assert_eq!(result.len(), 1);
        let step = &result[0].path[0];
        assert_eq!(step.source_entity_id, b);
        assert_eq!(step.target_entity_id, a);
        assert_eq!(step.edge_kind, "Extends");
        assert!((step.confidence - 0.8).abs() < f64::EPSILON);
    }

    #[test]
    fn skipped_entities_not_in_entities_list_are_ignored() {
        let repo = Uuid::now_v7();
        let changed = Uuid::now_v7();
        let ghost = Uuid::now_v7();
        let entities = vec![entity(changed, repo)];
        let edges = vec![edge(ghost, changed, EdgeKind::Calls, 1.0)];
        let analyzer = ImpactAnalyzer::default();
        let result = analyzer.analyze(&[changed], &entities, &edges);
        assert!(result.is_empty());
    }

    #[test]
    fn multiple_changed_entities_merge_results() {
        let repo = Uuid::now_v7();
        let a = Uuid::now_v7();
        let b = Uuid::now_v7();
        let caller = Uuid::now_v7();
        let entities = vec![entity(a, repo), entity(b, repo), entity(caller, repo)];
        let edges = vec![
            edge(caller, a, EdgeKind::Calls, 1.0),
            edge(caller, b, EdgeKind::Calls, 1.0),
        ];
        let analyzer = ImpactAnalyzer::default();
        let result = analyzer.analyze(&[a, b], &entities, &edges);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].entity_id, caller);
    }
}
