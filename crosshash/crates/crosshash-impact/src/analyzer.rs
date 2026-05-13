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
