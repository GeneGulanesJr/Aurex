use crate::{AffectedEntity, ChangedEntity, ImpactClassification};
use chrono::{DateTime, Utc};
use crosshash_core::RiskLevel;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReportFormat {
    Json,
    Markdown,
    Sarif,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImpactReportBuilder {
    pub changed_repos: Vec<Uuid>,
    pub affected_repos: Vec<Uuid>,
    pub changed_entities: Vec<ChangedEntity>,
    pub affected_entities: Vec<AffectedEntity>,
    pub classifications: Vec<ImpactClassification>,
    pub generated_at: DateTime<Utc>,
}

impl ImpactReportBuilder {
    pub fn risk_score(&self) -> f64 {
        self.classifications
            .iter()
            .map(|c| c.risk_score)
            .fold(0.0, f64::max)
    }
    pub fn risk_level(&self) -> RiskLevel {
        crate::classify::risk_level(self.risk_score())
    }
    pub fn render(&self, format: ReportFormat) -> String {
        match format { ReportFormat::Json => serde_json::to_string_pretty(self).unwrap(), ReportFormat::Markdown => self.markdown(), ReportFormat::Sarif => serde_json::json!({"version":"2.1.0","runs":[{"tool":{"driver":{"name":"crosshash"}},"results": self.classifications.iter().map(|c| serde_json::json!({"message":{"text": c.reasoning},"level": if c.risk_score >= 0.85 {"error"} else {"warning"}})).collect::<Vec<_>>() }]}).to_string() }
    }
    fn markdown(&self) -> String {
        format!("# CrossHash Impact Report\n\nChanged entities: {} across {} repos\nAffected entities: {} across {} repos\nRisk: {:?} ({:.2})\n", self.changed_entities.len(), self.changed_repos.len(), self.affected_entities.len(), self.affected_repos.len(), self.risk_level(), self.risk_score())
    }
}
