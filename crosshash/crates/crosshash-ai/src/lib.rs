pub mod api_surface;
pub mod client;
pub mod config;
pub mod cost_tracker;
pub mod edge_inference;
pub mod feedback;
pub mod gate;
pub mod prompts;

pub use api_surface::{ApiSurface, PublicEntitySurface, SurfaceKind};
pub use client::{LlmClient, LlmProvider, LlmRequest, LlmResponse, TokenUsage};
pub use config::AiConfig;
pub use cost_tracker::{AiCostEvent, AiStats, CostTracker};
pub use edge_inference::{
    AiEdgeSuggestion, EdgeInferenceEngine, InferredEdgeType, SuggestionStatus,
};
pub use feedback::{FeedbackDecision, FeedbackEvent, FeedbackStats};
pub use gate::{AiGate, GateDecision, GateInput, GateReason};
pub use prompts::PromptBuilder;
