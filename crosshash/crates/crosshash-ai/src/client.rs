use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LlmProvider {
    OpenAi,
    Anthropic,
    Ollama,
    OpenAiCompatible,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct TokenUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmRequest {
    pub provider: LlmProvider,
    pub endpoint: String,
    pub api_key: Option<String>,
    pub model: String,
    pub prompt: String,
    pub temperature: f32,
    pub max_tokens: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmResponse {
    pub json: Value,
    pub usage: TokenUsage,
}

#[derive(Debug, Clone)]
pub struct LlmClient {
    http: reqwest::Client,
    max_retries: usize,
}

impl Default for LlmClient {
    fn default() -> Self {
        Self {
            http: reqwest::Client::new(),
            max_retries: 2,
        }
    }
}

impl LlmClient {
    pub fn new(max_retries: usize) -> Self {
        Self {
            max_retries,
            ..Self::default()
        }
    }

    pub async fn complete_json(&self, req: &LlmRequest) -> Result<LlmResponse> {
        let mut last_error = None;
        for attempt in 0..=self.max_retries {
            match self.send_once(req).await {
                Ok(response) => return Ok(response),
                Err(err) => {
                    last_error = Some(err);
                    if attempt < self.max_retries {
                        tokio::time::sleep(std::time::Duration::from_millis(
                            100 * (attempt as u64 + 1),
                        ))
                        .await;
                    }
                }
            }
        }
        Err(last_error.unwrap_or_else(|| anyhow!("LLM request failed")))
    }

    async fn send_once(&self, req: &LlmRequest) -> Result<LlmResponse> {
        let body = match req.provider {
            LlmProvider::Anthropic => serde_json::json!({
                "model": req.model,
                "max_tokens": req.max_tokens,
                "temperature": req.temperature,
                "messages": [{"role": "user", "content": req.prompt}],
            }),
            _ => serde_json::json!({
                "model": req.model,
                "temperature": req.temperature,
                "max_tokens": req.max_tokens,
                "messages": [{"role": "user", "content": req.prompt}],
                "response_format": {"type": "json_object"}
            }),
        };
        let mut request = self.http.post(&req.endpoint).json(&body);
        if let Some(key) = &req.api_key {
            request = request.bearer_auth(key);
        }
        if req.provider == LlmProvider::Anthropic {
            request = request.header("anthropic-version", "2023-06-01");
        }
        let value: Value = request.send().await?.error_for_status()?.json().await?;
        let text = extract_text(&value).unwrap_or_else(|| value.to_string());
        let json = serde_json::from_str(&text).unwrap_or(value.clone());
        Ok(LlmResponse {
            json,
            usage: extract_usage(&value, &req.prompt, &text),
        })
    }
}

fn extract_text(value: &Value) -> Option<String> {
    value
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| {
            value
                .pointer("/message/content")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .or_else(|| {
            value
                .pointer("/content/0/text")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .or_else(|| {
            value
                .pointer("/response")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
}

fn extract_usage(value: &Value, prompt: &str, output: &str) -> TokenUsage {
    TokenUsage {
        input_tokens: value
            .pointer("/usage/prompt_tokens")
            .or_else(|| value.pointer("/usage/input_tokens"))
            .and_then(Value::as_u64)
            .unwrap_or((prompt.len() / 4) as u64),
        output_tokens: value
            .pointer("/usage/completion_tokens")
            .or_else(|| value.pointer("/usage/output_tokens"))
            .and_then(Value::as_u64)
            .unwrap_or((output.len() / 4) as u64),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_openai_json_content_and_usage() {
        let raw = serde_json::json!({"choices":[{"message":{"content":"{\"edges\":[]}"}}],"usage":{"prompt_tokens":12,"completion_tokens":3}});
        assert_eq!(extract_text(&raw).unwrap(), "{\"edges\":[]}");
        assert_eq!(extract_usage(&raw, "abcd", "efgh").input_tokens, 12);
    }

    #[test]
    fn extracts_anthropic_json_content() {
        let raw = serde_json::json!({"content":[{"type":"text","text":"{"found":true}"}]});
        assert_eq!(extract_text(&raw).unwrap(), "{"found":true}");
    }

    #[test]
    fn extracts_ollama_json_content() {
        let raw = serde_json::json!({"content":[{"type":"text","text":"{"model":"llama"}"}],"done":true});
        let text = extract_text(&raw).unwrap();
        assert!(text.contains("llama"));
    }

    #[test]
    fn extract_usage_falls_back_to_char_estimate() {
        let raw = serde_json::json!({"choices":[{"message":{"content":"hello world"}}]});
        let usage = extract_usage(&raw, "a".repeat(40).as_str(), "b".repeat(20).as_str());
        assert_eq!(usage.input_tokens, 10);
        assert_eq!(usage.output_tokens, 5);
    }

    #[test]
    fn llm_request_serializes_provider() {
        let req = LlmRequest {
            provider: LlmProvider::Anthropic,
            endpoint: "https://api.anthropic.com/v1/messages".into(),
            api_key: Some("sk-test".into()),
            model: "claude-3".into(),
            prompt: "test".into(),
            temperature: 0.0,
            max_tokens: 1024,
        };
        assert_eq!(req.provider, LlmProvider::Anthropic);
        assert_eq!(req.max_tokens, 1024);
    }

    #[test]
    fn token_usage_default_is_zero() {
        let usage = TokenUsage::default();
        assert_eq!(usage.input_tokens, 0);
        assert_eq!(usage.output_tokens, 0);
    }
}
