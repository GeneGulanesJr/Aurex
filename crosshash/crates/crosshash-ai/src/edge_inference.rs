use crate::{ApiSurface, FeedbackEvent, LlmClient, LlmRequest, PromptBuilder};
use anyhow::Result;
use chrono::Utc;
use crosshash_core::{Edge, EdgeKind, EdgeSource};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum InferredEdgeType {
    APIContract,
    SharedType,
    DataFlow,
    EventContract,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SuggestionStatus {
    Pending,
    Accepted,
    Rejected,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AiEdgeSuggestion {
    pub id: Uuid,
    pub exporter_entity_id: Uuid,
    pub consumer_entity_id: Uuid,
    pub edge_type: InferredEdgeType,
    pub reasoning: String,
    pub confidence: f64,
    pub status: SuggestionStatus,
}

pub struct EdgeInferenceEngine {
    pub auto_accept_threshold: f64,
    pub languages: Vec<String>,
    pub feedback: Vec<FeedbackEvent>,
}

impl Default for EdgeInferenceEngine {
    fn default() -> Self {
        Self {
            auto_accept_threshold: 0.95,
            languages: Vec::new(),
            feedback: Vec::new(),
        }
    }
}

impl EdgeInferenceEngine {
    pub async fn infer(
        &self,
        client: &LlmClient,
        req: &LlmRequest,
        exporter: &ApiSurface,
        consumer: &ApiSurface,
    ) -> Result<Vec<AiEdgeSuggestion>> {
        let prompt = PromptBuilder::new()
            .with_language_context(self.languages.join(", "))
            .with_feedback(self.feedback.clone())
            .build_edge_inference_prompt(exporter, consumer);
        let mut request = req.clone();
        request.prompt = prompt;
        let response = client.complete_json(&request).await?;
        Ok(parse_suggestions(&response.json))
    }

    pub fn accept_high_confidence(&self, suggestions: &[AiEdgeSuggestion]) -> Vec<Edge> {
        suggestions
            .iter()
            .filter(|s| s.confidence >= self.auto_accept_threshold)
            .map(|s| Edge {
                id: s.id,
                source_entity_id: s.consumer_entity_id,
                target_entity_id: s.exporter_entity_id,
                kind: EdgeKind::PackageDep,
                confidence: s.confidence,
                source: EdgeSource::AiInferred,
                metadata: Some(
                    serde_json::json!({"edge_type": s.edge_type, "reasoning": s.reasoning}),
                ),
                created_at: Utc::now(),
                validated_at: None,
            })
            .collect()
    }
}

pub fn parse_suggestions(value: &serde_json::Value) -> Vec<AiEdgeSuggestion> {
    value
        .get("edges")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
        .filter_map(|edge| {
            let a = Uuid::parse_str(edge.get("entity_a")?.as_str()?).ok()?;
            let b = Uuid::parse_str(edge.get("entity_b")?.as_str()?).ok()?;
            let edge_type = match edge
                .get("edge_type")
                .and_then(|v| v.as_str())
                .unwrap_or("APIContract")
            {
                "SharedType" => InferredEdgeType::SharedType,
                "DataFlow" => InferredEdgeType::DataFlow,
                "EventContract" => InferredEdgeType::EventContract,
                _ => InferredEdgeType::APIContract,
            };
            Some(AiEdgeSuggestion {
                id: Uuid::new_v5(&a, format!("{b}:{edge_type:?}").as_bytes()),
                exporter_entity_id: a,
                consumer_entity_id: b,
                edge_type,
                reasoning: edge
                    .get("reasoning")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .into(),
                confidence: edge
                    .get("confidence")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.5),
                status: SuggestionStatus::Pending,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_llm_edges() {
        let a = Uuid::now_v7();
        let b = Uuid::now_v7();
        let out = parse_suggestions(
            &serde_json::json!({"edges":[{"entity_a":a,"entity_b":b,"edge_type":"DataFlow","reasoning":"uses payload","confidence":0.96}]}),
        );
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].edge_type, InferredEdgeType::DataFlow);
    }

    #[test]
    fn accept_high_confidence_filters_by_threshold() {
        let engine = EdgeInferenceEngine {
            auto_accept_threshold: 0.9,
            ..Default::default()
        };
        let a = Uuid::now_v7();
        let b = Uuid::now_v7();
        let c = Uuid::now_v7();
        let suggestions = vec![
            AiEdgeSuggestion { id: Uuid::now_v7(), exporter_entity_id: a, consumer_entity_id: b, edge_type: InferredEdgeType::APIContract, reasoning: "high".into(), confidence: 0.95, status: SuggestionStatus::Pending },
            AiEdgeSuggestion { id: Uuid::now_v7(), exporter_entity_id: a, consumer_entity_id: c, edge_type: InferredEdgeType::SharedType, reasoning: "low".into(), confidence: 0.7, status: SuggestionStatus::Pending },
        ];
        let accepted = engine.accept_high_confidence(&suggestions);
        assert_eq!(accepted.len(), 1);
    }

    #[test]
    fn accept_high_confidence_converts_to_edges() {
        let engine = EdgeInferenceEngine::default();
        let a = Uuid::now_v7();
        let b = Uuid::now_v7();
        let suggestions = vec![
            AiEdgeSuggestion { id: Uuid::now_v7(), exporter_entity_id: a, consumer_entity_id: b, edge_type: InferredEdgeType::DataFlow, reasoning: "test".into(), confidence: 0.99, status: SuggestionStatus::Pending },
        ];
        let edges = engine.accept_high_confidence(&suggestions);
        assert_eq!(edges.len(), 1);
        assert_eq!(edges[0].source, EdgeSource::AiInferred);
        assert_eq!(edges[0].target_entity_id, a);
        assert_eq!(edges[0].source_entity_id, b);
    }

    #[test]
    fn parse_suggestions_handles_empty_edges() {
        let out = parse_suggestions(&serde_json::json!({"edges": []}));
        assert!(out.is_empty());
    }

    #[test]
    fn parse_suggestions_handles_all_edge_types() {
        let a = Uuid::now_v7();
        let b = Uuid::now_v7();
        let c = Uuid::now_v7();
        let d = Uuid::now_v7();
        let out = parse_suggestions(
            &serde_json::json!({"edges":[
                {"entity_a":a,"entity_b":b,"edge_type":"SharedType","confidence":0.8},
                {"entity_a":a,"entity_b":c,"edge_type":"DataFlow","confidence":0.7},
                {"entity_a":a,"entity_b":d,"edge_type":"EventContract","confidence":0.9},
            ]}),
        );
        assert_eq!(out.len(), 3);
        assert_eq!(out[0].edge_type, InferredEdgeType::SharedType);
        assert_eq!(out[1].edge_type, InferredEdgeType::DataFlow);
        assert_eq!(out[2].edge_type, InferredEdgeType::EventContract);
    }

    #[test]
    fn parse_suggestions_handles_missing_confidence_default() {
        let a = Uuid::now_v7();
        let b = Uuid::now_v7();
        let out = parse_suggestions(
            &serde_json::json!({"edges":[{"entity_a":a,"entity_b":b,"edge_type":"APIContract"}]}),
        );
        assert_eq!(out.len(), 1);
        assert!((out[0].confidence - 0.5).abs() < 0.001);
    }
}
