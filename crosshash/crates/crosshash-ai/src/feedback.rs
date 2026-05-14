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
            FeedbackEvent { suggestion_id: Uuid::now_v7(), edge_type: InferredEdgeType::APIContract, language: "Rust".into(), confidence: 0.9, decision: FeedbackDecision::Accept },
            FeedbackEvent { suggestion_id: Uuid::now_v7(), edge_type: InferredEdgeType::SharedType, language: "Rust".into(), confidence: 0.85, decision: FeedbackDecision::Accept },
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
            FeedbackEvent { suggestion_id: Uuid::now_v7(), edge_type: InferredEdgeType::APIContract, language: "Rust".into(), confidence: 0.9, decision: FeedbackDecision::Accept },
            FeedbackEvent { suggestion_id: Uuid::now_v7(), edge_type: InferredEdgeType::DataFlow, language: "Rust".into(), confidence: 0.7, decision: FeedbackDecision::Reject },
            FeedbackEvent { suggestion_id: Uuid::now_v7(), edge_type: InferredEdgeType::SharedType, language: "Rust".into(), confidence: 0.6, decision: FeedbackDecision::Reject },
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
            FeedbackEvent { suggestion_id: Uuid::now_v7(), edge_type: InferredEdgeType::APIContract, language: "Rust".into(), confidence: 0.95, decision: FeedbackDecision::Accept },
            FeedbackEvent { suggestion_id: Uuid::now_v7(), edge_type: InferredEdgeType::DataFlow, language: "Rust".into(), confidence: 0.9, decision: FeedbackDecision::Accept },
            FeedbackEvent { suggestion_id: Uuid::now_v7(), edge_type: InferredEdgeType::SharedType, language: "Rust".into(), confidence: 0.8, decision: FeedbackDecision::Reject },
        ];
        let stats = FeedbackStats::from_events(&events);
        assert!((stats.precision - 2.0 / 3.0).abs() < 0.001);
        assert!((stats.calibrated_threshold - 0.98).abs() < 0.001);
    }
}
