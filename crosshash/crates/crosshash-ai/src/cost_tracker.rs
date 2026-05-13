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
