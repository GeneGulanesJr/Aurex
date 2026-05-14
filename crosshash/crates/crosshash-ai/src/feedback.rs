use crate::InferredEdgeType;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FeedbackDecision {
    Accept,
    Reject,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeedbackEvent {
    pub suggestion_id: Uuid,
    pub edge_type: InferredEdgeType,
    pub language: String,
    pub confidence: f64,
    pub decision: FeedbackDecision,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct FeedbackStats {
    pub total: usize,
    pub accepted: usize,
    pub rejected: usize,
    pub precision: f64,
    pub calibrated_threshold: f64,
}

impl FeedbackStats {
    pub fn from_events(events: &[FeedbackEvent]) -> Self {
        let accepted = events
            .iter()
            .filter(|e| e.decision == FeedbackDecision::Accept)
            .count();
        let total = events.len();
        let precision = if total == 0 {
            1.0
        } else {
            accepted as f64 / total as f64
        };
        Self {
            total,
            accepted,
            rejected: total - accepted,
            precision,
            calibrated_threshold: if precision < 0.85 { 0.98 } else { 0.95 },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_event(decision: FeedbackDecision, confidence: f64) -> FeedbackEvent {
        FeedbackEvent {
            suggestion_id: Uuid::now_v7(),
            edge_type: InferredEdgeType::APIContract,
            language: "Rust".into(),
            confidence,
            decision,
        }
    }

    #[test]
    fn from_events_empty_returns_perfect_precision() {
        let stats = FeedbackStats::from_events(&[]);
        assert_eq!(stats.total, 0);
        assert!((stats.precision - 1.0).abs() < 0.001);
        assert!((stats.calibrated_threshold - 0.95).abs() < 0.001);
    }

    #[test]
    fn from_events_all_accepted() {
        let events = vec![
            FeedbackEvent {
                suggestion_id: Uuid::now_v7(),
                edge_type: InferredEdgeType::APIContract,
                language: "Rust".into(),
                confidence: 0.9,
                decision: FeedbackDecision::Accept,
            },
            FeedbackEvent {
                suggestion_id: Uuid::now_v7(),
                edge_type: InferredEdgeType::SharedType,
                language: "Rust".into(),
                confidence: 0.85,
                decision: FeedbackDecision::Accept,
            },
        ];
        let stats = FeedbackStats::from_events(&events);
        assert_eq!(stats.total, 2);
        assert_eq!(stats.accepted, 2);
        assert_eq!(stats.rejected, 0);
        assert!((stats.precision - 1.0).abs() < 0.001);
    }

    #[test]
    fn from_events_mixed_calibrates_threshold() {
        let events = vec![
            FeedbackEvent {
                suggestion_id: Uuid::now_v7(),
                edge_type: InferredEdgeType::APIContract,
                language: "Rust".into(),
                confidence: 0.9,
                decision: FeedbackDecision::Accept,
            },
            FeedbackEvent {
                suggestion_id: Uuid::now_v7(),
                edge_type: InferredEdgeType::DataFlow,
                language: "Rust".into(),
                confidence: 0.7,
                decision: FeedbackDecision::Reject,
            },
            FeedbackEvent {
                suggestion_id: Uuid::now_v7(),
                edge_type: InferredEdgeType::SharedType,
                language: "Rust".into(),
                confidence: 0.6,
                decision: FeedbackDecision::Reject,
            },
        ];
        let stats = FeedbackStats::from_events(&events);
        assert_eq!(stats.total, 3);
        assert_eq!(stats.accepted, 1);
        assert_eq!(stats.rejected, 2);
        assert!((stats.precision - 1.0 / 3.0).abs() < 0.001);
        assert!((stats.calibrated_threshold - 0.98).abs() < 0.001);
    }

    #[test]
    fn from_events_high_precision_keeps_default_threshold() {
        let events = vec![
            FeedbackEvent {
                suggestion_id: Uuid::now_v7(),
                edge_type: InferredEdgeType::APIContract,
                language: "Rust".into(),
                confidence: 0.95,
                decision: FeedbackDecision::Accept,
            },
            FeedbackEvent {
                suggestion_id: Uuid::now_v7(),
                edge_type: InferredEdgeType::DataFlow,
                language: "Rust".into(),
                confidence: 0.9,
                decision: FeedbackDecision::Accept,
            },
            FeedbackEvent {
                suggestion_id: Uuid::now_v7(),
                edge_type: InferredEdgeType::SharedType,
                language: "Rust".into(),
                confidence: 0.8,
                decision: FeedbackDecision::Reject,
            },
        ];
        let stats = FeedbackStats::from_events(&events);
        assert!((stats.precision - 2.0 / 3.0).abs() < 0.001);
        assert!((stats.calibrated_threshold - 0.98).abs() < 0.001);
    }

    #[test]
    fn single_accept_event_precision_one() {
        let events = vec![make_event(FeedbackDecision::Accept, 0.9)];
        let stats = FeedbackStats::from_events(&events);
        assert_eq!(stats.total, 1);
        assert_eq!(stats.accepted, 1);
        assert_eq!(stats.rejected, 0);
        assert!((stats.precision - 1.0).abs() < 0.001);
        assert!((stats.calibrated_threshold - 0.95).abs() < 0.001);
    }

    #[test]
    fn single_reject_event_precision_zero() {
        let events = vec![make_event(FeedbackDecision::Reject, 0.9)];
        let stats = FeedbackStats::from_events(&events);
        assert_eq!(stats.total, 1);
        assert_eq!(stats.accepted, 0);
        assert_eq!(stats.rejected, 1);
        assert!((stats.precision - 0.0).abs() < 0.001);
        assert!((stats.calibrated_threshold - 0.98).abs() < 0.001);
    }

    #[test]
    fn feedback_decision_serialization_roundtrip() {
        let accept_json = serde_json::to_string(&FeedbackDecision::Accept).unwrap();
        assert_eq!(accept_json, "\"Accept\"");
        let parsed: FeedbackDecision = serde_json::from_str(&accept_json).unwrap();
        assert_eq!(parsed, FeedbackDecision::Accept);

        let reject_json = serde_json::to_string(&FeedbackDecision::Reject).unwrap();
        assert_eq!(reject_json, "\"Reject\"");
        let parsed: FeedbackDecision = serde_json::from_str(&reject_json).unwrap();
        assert_eq!(parsed, FeedbackDecision::Reject);
    }

    #[test]
    fn feedback_event_serialization_roundtrip() {
        let event = FeedbackEvent {
            suggestion_id: Uuid::parse_str("019013a0-0000-7000-8000-000000000001").unwrap(),
            edge_type: InferredEdgeType::DataFlow,
            language: "TypeScript".into(),
            confidence: 0.88,
            decision: FeedbackDecision::Accept,
        };
        let json = serde_json::to_string(&event).unwrap();
        let parsed: FeedbackEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.suggestion_id, event.suggestion_id);
        assert_eq!(parsed.edge_type, event.edge_type);
        assert_eq!(parsed.language, event.language);
        assert!((parsed.confidence - event.confidence).abs() < 0.001);
        assert_eq!(parsed.decision, event.decision);
    }

    #[test]
    fn feedback_stats_default_values() {
        let stats = FeedbackStats::default();
        assert_eq!(stats.total, 0);
        assert_eq!(stats.accepted, 0);
        assert_eq!(stats.rejected, 0);
        assert!((stats.precision - 0.0).abs() < 0.001);
        assert!((stats.calibrated_threshold - 0.0).abs() < 0.001);
    }

    #[test]
    fn feedback_stats_serialization_roundtrip() {
        let stats = FeedbackStats {
            total: 10,
            accepted: 8,
            rejected: 2,
            precision: 0.8,
            calibrated_threshold: 0.98,
        };
        let json = serde_json::to_string(&stats).unwrap();
        let parsed: FeedbackStats = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, stats);
    }

    #[test]
    fn threshold_boundary_exactly_85_percent() {
        let mut events = vec![];
        for _ in 0..85 {
            events.push(make_event(FeedbackDecision::Accept, 0.9));
        }
        for _ in 0..15 {
            events.push(make_event(FeedbackDecision::Reject, 0.7));
        }
        let stats = FeedbackStats::from_events(&events);
        assert!((stats.precision - 0.85).abs() < 0.001);
        assert!((stats.calibrated_threshold - 0.95).abs() < 0.001);
    }

    #[test]
    fn threshold_just_below_85_percent() {
        let mut events = vec![];
        for _ in 0..84 {
            events.push(make_event(FeedbackDecision::Accept, 0.9));
        }
        for _ in 0..16 {
            events.push(make_event(FeedbackDecision::Reject, 0.7));
        }
        let stats = FeedbackStats::from_events(&events);
        assert!(stats.precision < 0.85);
        assert!((stats.calibrated_threshold - 0.98).abs() < 0.001);
    }

    #[test]
    fn all_rejected_precision_zero_high_threshold() {
        let events = vec![
            make_event(FeedbackDecision::Reject, 0.9),
            make_event(FeedbackDecision::Reject, 0.8),
            make_event(FeedbackDecision::Reject, 0.7),
        ];
        let stats = FeedbackStats::from_events(&events);
        assert_eq!(stats.accepted, 0);
        assert_eq!(stats.rejected, 3);
        assert!((stats.precision - 0.0).abs() < 0.001);
        assert!((stats.calibrated_threshold - 0.98).abs() < 0.001);
    }
}
