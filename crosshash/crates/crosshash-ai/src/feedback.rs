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
