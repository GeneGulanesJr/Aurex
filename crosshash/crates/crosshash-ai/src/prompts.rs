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
        let languages = if self.language_context.is_empty() {
            "unknown".into()
        } else {
            self.language_context.join(", ")
        };
        let feedback_section = if self.feedback.is_empty() {
            String::new()
        } else {
            let examples: Vec<String> = self
                .feedback
                .iter()
                .map(|f| {
                    format!(
                        "- edge_type={:?} confidence={:.2} decision={:?}",
                        f.edge_type, f.confidence, f.decision
                    )
                })
                .collect();
            format!(
                "\nPrevious feedback (learn from corrections): {}",
                examples.join("; ")
            )
        };
        let exporter_json = exporter.to_prompt_json();
        let consumer_json = consumer.to_prompt_json();
        let exporter_count = exporter.entities.len();
        let consumer_count = consumer.entities.len();
        format!(
            "You are a cross-repo dependency analyzer. Languages: {languages}. \
             Infer ONLY cross-repo dependencies from public API surfaces. Do NOT use internal/private code. \
             Look for: API contracts (function calls, type references), shared types (struct/class reuse), \
             data flow (parameter passing, return types), event contracts (pub/sub patterns).\
             {feedback_section}\n\
             Repo A exports ({exporter_count} public entities): {exporter_json}\n\
             Repo B consumes ({consumer_count} public entities): {consumer_json}\n\
             Return JSON only: {{\"edges\":[{{\"entity_a\":\"uuid\",\"entity_b\":\"uuid\",\
             \"edge_type\":\"APIContract|SharedType|DataFlow|EventContract\",\
             \"reasoning\":\"...\",\"confidence\":0.0}}]}}"
        )
    }
}
