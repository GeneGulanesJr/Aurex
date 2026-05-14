use crate::client::LlmProvider;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiConfig {
    pub enabled: bool,
    pub auto_gate: bool,
    pub provider: String,
    pub model: String,
    pub api_key_env: String,
    pub temperature: f32,
    pub max_tokens: u32,
    pub confidence_auto_accept: f64,
    pub max_daily_cost_usd: f64,
}

impl Default for AiConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            auto_gate: true,
            provider: "ollama".into(),
            model: "llama3.1".into(),
            api_key_env: "OPENAI_API_KEY".into(),
            temperature: 0.0,
            max_tokens: 2048,
            confidence_auto_accept: 0.95,
            max_daily_cost_usd: 10.0,
        }
    }
}

impl AiConfig {
    pub fn load(path: &Path) -> Result<Self> {
        if !path.exists() {
            return Ok(Self::default());
        }
        let content = std::fs::read_to_string(path)?;
        let value: toml::Value = toml::from_str(&content)?;
        let ai_section = value.get("ai");
        match ai_section {
            Some(section) => {
                let section_str = toml::to_string(section)?;
                let config: AiConfig = toml::from_str(&section_str)?;
                Ok(config)
            }
            None => Ok(Self::default()),
        }
    }

    pub fn load_from_crosshash_dir(repo_path: &Path) -> Result<Self> {
        let candidates = [
            repo_path.join(".crosshash").join("config.toml"),
            repo_path.join("config").join("default.toml"),
        ];
        for candidate in &candidates {
            if candidate.exists() {
                return Self::load(candidate);
            }
        }
        Ok(Self::default())
    }

    pub fn provider(&self) -> LlmProvider {
        match self.provider.to_lowercase().as_str() {
            "openai" => LlmProvider::OpenAi,
            "anthropic" | "claude" => LlmProvider::Anthropic,
            "openai-compatible" => LlmProvider::OpenAiCompatible,
            _ => LlmProvider::Ollama,
        }
    }

    pub fn endpoint(&self) -> String {
        match self.provider() {
            LlmProvider::OpenAi => "https://api.openai.com/v1/chat/completions".into(),
            LlmProvider::Anthropic => "https://api.anthropic.com/v1/messages".into(),
            LlmProvider::Ollama => "http://localhost:11434/api/chat".into(),
            LlmProvider::OpenAiCompatible => "http://localhost:8080/v1/chat/completions".into(),
        }
    }

    pub fn api_key(&self) -> Option<String> {
        std::env::var(&self.api_key_env).ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_has_sensible_values() {
        let config = AiConfig::default();
        assert!(config.enabled);
        assert!(config.auto_gate);
        assert_eq!(config.provider(), LlmProvider::Ollama);
        assert!(config.endpoint().contains("localhost"));
    }

    #[test]
    fn parses_provider_correctly() {
        let config = AiConfig {
            provider: "openai".into(),
            ..Default::default()
        };
        assert_eq!(config.provider(), LlmProvider::OpenAi);
        assert!(config.endpoint().contains("openai.com"));
        let config = AiConfig {
            provider: "anthropic".into(),
            ..Default::default()
        };
        assert_eq!(config.provider(), LlmProvider::Anthropic);
        assert!(config.endpoint().contains("anthropic.com"));
    }
}
