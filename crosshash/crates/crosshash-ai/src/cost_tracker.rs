use crate::{GateReason, TokenUsage};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiCostEvent {
    pub at: DateTime<Utc>,
    pub repo_a: Option<Uuid>,
    pub repo_b: Option<Uuid>,
    pub trigger: GateReason,
    pub usage: TokenUsage,
    pub estimated_cost_usd: f64,
    pub edges_suggested: usize,
    pub edges_auto_accepted: usize,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AiStats {
    pub invocations: usize,
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub total_cost_usd: f64,
    pub edges_suggested: usize,
    pub edges_auto_accepted: usize,
}

#[derive(Debug, Default)]
pub struct CostTracker {
    events: Vec<AiCostEvent>,
}

impl CostTracker {
    pub fn record(&mut self, event: AiCostEvent) {
        self.events.push(event);
    }
    pub fn events(&self) -> &[AiCostEvent] {
        &self.events
    }
    pub fn stats(&self) -> AiStats {
        self.events.iter().fold(AiStats::default(), |mut s, e| {
            s.invocations += 1;
            s.total_input_tokens += e.usage.input_tokens;
            s.total_output_tokens += e.usage.output_tokens;
            s.total_cost_usd += e.estimated_cost_usd;
            s.edges_suggested += e.edges_suggested;
            s.edges_auto_accepted += e.edges_auto_accepted;
            s
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::GateReason;

    #[test]
    fn record_and_stats() {
        let mut tracker = CostTracker::default();
        tracker.record(AiCostEvent {
            at: chrono::Utc::now(),
            repo_a: Some(Uuid::now_v7()),
            repo_b: Some(Uuid::now_v7()),
            trigger: GateReason::NewExports,
            usage: crate::TokenUsage {
                input_tokens: 100,
                output_tokens: 50,
            },
            estimated_cost_usd: 0.005,
            edges_suggested: 3,
            edges_auto_accepted: 1,
        });
        let stats = tracker.stats();
        assert_eq!(stats.invocations, 1);
        assert_eq!(stats.total_input_tokens, 100);
        assert_eq!(stats.total_output_tokens, 50);
        assert!((stats.total_cost_usd - 0.005).abs() < 0.0001);
        assert_eq!(stats.edges_suggested, 3);
        assert_eq!(stats.edges_auto_accepted, 1);
    }

    #[test]
    fn multiple_events_accumulate() {
        let mut tracker = CostTracker::default();
        for _ in 0..3 {
            tracker.record(AiCostEvent {
                at: chrono::Utc::now(),
                repo_a: None,
                repo_b: None,
                trigger: GateReason::Forced,
                usage: crate::TokenUsage {
                    input_tokens: 50,
                    output_tokens: 25,
                },
                estimated_cost_usd: 0.001,
                edges_suggested: 1,
                edges_auto_accepted: 0,
            });
        }
        let stats = tracker.stats();
        assert_eq!(stats.invocations, 3);
        assert_eq!(stats.total_input_tokens, 150);
        assert_eq!(stats.total_output_tokens, 75);
        assert!((stats.total_cost_usd - 0.003).abs() < 0.0001);
    }

    #[test]
    fn empty_tracker_returns_zero_stats() {
        let tracker = CostTracker::default();
        let stats = tracker.stats();
        assert_eq!(stats.invocations, 0);
        assert_eq!(stats.total_input_tokens, 0);
        assert_eq!(stats.total_cost_usd, 0.0);
    }

    #[test]
    fn events_returns_recorded_events() {
        let mut tracker = CostTracker::default();
        tracker.record(AiCostEvent {
            at: chrono::Utc::now(),
            repo_a: None,
            repo_b: None,
            trigger: GateReason::SignatureChanged,
            usage: crate::TokenUsage {
                input_tokens: 10,
                output_tokens: 5,
            },
            estimated_cost_usd: 0.0,
            edges_suggested: 0,
            edges_auto_accepted: 0,
        });
        assert_eq!(tracker.events().len(), 1);
        assert_eq!(tracker.events()[0].trigger, GateReason::SignatureChanged);
    }
}
