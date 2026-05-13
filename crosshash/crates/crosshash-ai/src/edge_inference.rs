use crate::{ApiSurface, LlmClient, LlmRequest};
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
}

impl Default for EdgeInferenceEngine {
    fn default() -> Self {
        Self {
            auto_accept_threshold: 0.95,
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
        let mut request = req.clone();
        request.prompt = format!("Which symbols in repo B consume or depend on APIs exported by repo A? Return JSON {{\"edges\":[{{\"entity_a\":\"uuid\",\"entity_b\":\"uuid\",\"edge_type\":\"APIContract\",\"reasoning\":\"...\",\"confidence\":0.0}}]}}.\nRepo A: {}\nRepo B: {}", exporter.to_prompt_json(), consumer.to_prompt_json());
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
}
