use crate::{ApiSurface, FeedbackEvent};

#[derive(Debug, Clone, Default)]
pub struct PromptBuilder {
    language_context: Vec<String>,
    feedback: Vec<FeedbackEvent>,
}

impl PromptBuilder {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn with_language_context(mut self, ctx: impl Into<String>) -> Self {
        self.language_context.push(ctx.into());
        self
    }
    pub fn with_feedback(mut self, feedback: Vec<FeedbackEvent>) -> Self {
        self.feedback = feedback;
        self
    }
    pub fn build_edge_inference_prompt(
        &self,
        exporter: &ApiSurface,
        consumer: &ApiSurface,
    ) -> String {
        format!("Infer only cross-repo dependencies from public API surfaces. Do not use internal code. Languages: {}. Feedback examples: {}. Repo A exports: {}. Repo B consumes: {}. Return JSON only.", self.language_context.join(", "), self.feedback.len(), exporter.to_prompt_json(), consumer.to_prompt_json())
    }
}
