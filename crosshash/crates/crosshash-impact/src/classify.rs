use crate::{AffectedEntity, ChangeKind};
use crosshash_core::{EdgeKind, RiskLevel};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ImpactClassification {
    pub entity_id: Uuid,
    pub classification: String,
    pub risk_score: f64,
    pub risk_level: RiskLevel,
    pub reasoning: String,
}

pub struct ImpactClassifier;
impl ImpactClassifier {
    pub fn classify(change_kind: ChangeKind, affected: &AffectedEntity) -> ImpactClassification {
        let edge_kind = affected
            .path
            .first()
            .map(|p| p.edge_kind.as_str())
            .unwrap_or("");
        let (class, score) = match (change_kind, edge_kind) {
            (ChangeKind::Deleted, _) => ("Breaking", 1.0),
            (ChangeKind::SignatureChanged, "Imports" | "PackageDep") => ("Breaking", 0.9),
            (ChangeKind::BodyOnly, "PackageDep") => ("NeedsUpdate", 0.7),
            (ChangeKind::BodyOnly, "Calls") => ("NeedsUpdate", 0.6),
            (ChangeKind::Moved | ChangeKind::Renamed, _) => ("Investigate", 0.4),
            _ if affected.min_confidence < 0.65 => ("Investigate", 0.5),
            _ => ("Safe", 0.1),
        };
        ImpactClassification {
            entity_id: affected.entity_id,
            classification: class.into(),
            risk_score: score,
            risk_level: risk_level(score),
            reasoning: format!(
                "{change_kind:?} propagated via {edge_kind} edge at confidence {:.2}",
                affected.min_confidence
            ),
        }
    }
}

pub fn risk_level(score: f64) -> RiskLevel {
    if score < 0.3 {
        RiskLevel::Low
    } else if score < 0.6 {
        RiskLevel::Medium
    } else if score < 0.85 {
        RiskLevel::High
    } else {
        RiskLevel::Critical
    }
}
#[allow(dead_code)]
fn _edge_kind(_: EdgeKind) {}
