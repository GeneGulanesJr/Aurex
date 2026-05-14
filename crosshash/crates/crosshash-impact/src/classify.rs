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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analyzer::ImpactPathStep;
    use uuid::Uuid;

    fn affected(edge_kind: &str, confidence: f64) -> AffectedEntity {
        AffectedEntity {
            entity_id: Uuid::now_v7(),
            distance: 1,
            min_confidence: confidence,
            path: vec![ImpactPathStep {
                source_entity_id: Uuid::now_v7(),
                target_entity_id: Uuid::now_v7(),
                edge_kind: edge_kind.to_string(),
                confidence,
            }],
        }
    }

    #[test]
    fn deleted_is_breaking_with_score_1() {
        let result = ImpactClassifier::classify(ChangeKind::Deleted, &affected("Calls", 1.0));
        assert_eq!(result.classification, "Breaking");
        assert!((result.risk_score - 1.0).abs() < f64::EPSILON);
        assert_eq!(result.risk_level, RiskLevel::Critical);
    }

    #[test]
    fn signature_changed_via_imports_is_breaking() {
        let result =
            ImpactClassifier::classify(ChangeKind::SignatureChanged, &affected("Imports", 0.9));
        assert_eq!(result.classification, "Breaking");
        assert!((result.risk_score - 0.9).abs() < f64::EPSILON);
        assert_eq!(result.risk_level, RiskLevel::Critical);
    }

    #[test]
    fn signature_changed_via_package_dep_is_breaking() {
        let result =
            ImpactClassifier::classify(ChangeKind::SignatureChanged, &affected("PackageDep", 0.8));
        assert_eq!(result.classification, "Breaking");
    }

    #[test]
    fn body_only_via_package_dep_needs_update() {
        let result = ImpactClassifier::classify(ChangeKind::BodyOnly, &affected("PackageDep", 0.7));
        assert_eq!(result.classification, "NeedsUpdate");
        assert!((result.risk_score - 0.7).abs() < f64::EPSILON);
        assert_eq!(result.risk_level, RiskLevel::High);
    }

    #[test]
    fn body_only_via_calls_needs_update() {
        let result = ImpactClassifier::classify(ChangeKind::BodyOnly, &affected("Calls", 0.8));
        assert_eq!(result.classification, "NeedsUpdate");
        assert!((result.risk_score - 0.6).abs() < f64::EPSILON);
        assert_eq!(result.risk_level, RiskLevel::High);
    }

    #[test]
    fn moved_is_investigate() {
        let result = ImpactClassifier::classify(ChangeKind::Moved, &affected("Calls", 0.9));
        assert_eq!(result.classification, "Investigate");
        assert!((result.risk_score - 0.4).abs() < f64::EPSILON);
    }

    #[test]
    fn renamed_is_investigate() {
        let result = ImpactClassifier::classify(ChangeKind::Renamed, &affected("Calls", 0.9));
        assert_eq!(result.classification, "Investigate");
    }

    #[test]
    fn low_confidence_is_investigate() {
        let result = ImpactClassifier::classify(ChangeKind::Modified, &affected("Calls", 0.5));
        assert_eq!(result.classification, "Investigate");
        assert!((result.risk_score - 0.5).abs() < f64::EPSILON);
    }

    #[test]
    fn modified_high_confidence_default_edge_is_safe() {
        let result = ImpactClassifier::classify(ChangeKind::Modified, &affected("Contains", 0.9));
        assert_eq!(result.classification, "Safe");
        assert!((result.risk_score - 0.1).abs() < f64::EPSILON);
        assert_eq!(result.risk_level, RiskLevel::Low);
    }

    #[test]
    fn reasoning_contains_change_kind_and_edge_info() {
        let result =
            ImpactClassifier::classify(ChangeKind::SignatureChanged, &affected("Imports", 0.85));
        assert!(result.reasoning.contains("SignatureChanged"));
        assert!(result.reasoning.contains("Imports"));
        assert!(result.reasoning.contains("0.85"));
    }

    #[test]
    fn risk_level_low() {
        assert_eq!(risk_level(0.1), RiskLevel::Low);
        assert_eq!(risk_level(0.29), RiskLevel::Low);
    }

    #[test]
    fn risk_level_medium() {
        assert_eq!(risk_level(0.3), RiskLevel::Medium);
        assert_eq!(risk_level(0.5), RiskLevel::Medium);
        assert_eq!(risk_level(0.59), RiskLevel::Medium);
    }

    #[test]
    fn risk_level_high() {
        assert_eq!(risk_level(0.6), RiskLevel::High);
        assert_eq!(risk_level(0.7), RiskLevel::High);
        assert_eq!(risk_level(0.84), RiskLevel::High);
    }

    #[test]
    fn risk_level_critical() {
        assert_eq!(risk_level(0.85), RiskLevel::Critical);
        assert_eq!(risk_level(1.0), RiskLevel::Critical);
    }

    #[test]
    fn no_path_defaults_to_empty_edge_kind() {
        let affected = AffectedEntity {
            entity_id: Uuid::now_v7(),
            distance: 0,
            min_confidence: 1.0,
            path: vec![],
        };
        let result = ImpactClassifier::classify(ChangeKind::Deleted, &affected);
        assert_eq!(result.classification, "Breaking");
    }
}
