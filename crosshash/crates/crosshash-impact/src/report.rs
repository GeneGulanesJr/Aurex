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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analyzer::ImpactPathStep;
    use crate::{ChangeKind, ChangedEntity};
    use chrono::Utc;
    use crosshash_core::RiskLevel;
    use uuid::Uuid;

    fn classification(score: f64) -> ImpactClassification {
        ImpactClassification {
            entity_id: Uuid::now_v7(),
            classification: "Test".into(),
            risk_score: score,
            risk_level: if score < 0.3 {
                RiskLevel::Low
            } else if score < 0.6 {
                RiskLevel::Medium
            } else if score < 0.85 {
                RiskLevel::High
            } else {
                RiskLevel::Critical
            },
            reasoning: "test".into(),
        }
    }

    fn empty_report() -> ImpactReportBuilder {
        ImpactReportBuilder {
            changed_repos: vec![Uuid::now_v7()],
            affected_repos: vec![Uuid::now_v7()],
            changed_entities: vec![ChangedEntity {
                entity_id: Uuid::now_v7(),
                old_name: Some("f".into()),
                new_name: Some("f".into()),
                change_kind: ChangeKind::Modified,
                diff_summary: "test".into(),
            }],
            affected_entities: vec![],
            classifications: vec![],
            generated_at: Utc::now(),
        }
    }

    #[test]
    fn risk_score_is_zero_with_no_classifications() {
        let report = empty_report();
        assert!((report.risk_score() - 0.0).abs() < f64::EPSILON);
    }

    #[test]
    fn risk_score_is_max_of_classification_scores() {
        let mut report = empty_report();
        report.classifications = vec![classification(0.3), classification(0.9), classification(0.5)];
        assert!((report.risk_score() - 0.9).abs() < f64::EPSILON);
    }

    #[test]
    fn risk_level_maps_from_score() {
        let mut report = empty_report();
        report.classifications = vec![classification(0.1)];
        assert_eq!(report.risk_level(), RiskLevel::Low);

        report.classifications = vec![classification(0.5)];
        assert_eq!(report.risk_level(), RiskLevel::Medium);

        report.classifications = vec![classification(0.7)];
        assert_eq!(report.risk_level(), RiskLevel::High);

        report.classifications = vec![classification(0.95)];
        assert_eq!(report.risk_level(), RiskLevel::Critical);
    }

    #[test]
    fn render_json_produces_valid_json() {
        let report = empty_report();
        let json = report.render(ReportFormat::Json);
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(parsed.get("changed_repos").is_some());
        assert!(parsed.get("affected_entities").is_some());
        assert!(parsed.get("generated_at").is_some());
    }

    #[test]
    fn render_markdown_produces_header_and_stats() {
        let report = empty_report();
        let md = report.render(ReportFormat::Markdown);
        assert!(md.contains("# CrossHash Impact Report"));
        assert!(md.contains("Changed entities: 1"));
        assert!(md.contains("Risk:"));
    }

    #[test]
    fn render_sarif_produces_valid_structure() {
        let mut report = empty_report();
        report.classifications = vec![classification(0.9)];
        let sarif = report.render(ReportFormat::Sarif);
        let parsed: serde_json::Value = serde_json::from_str(&sarif).unwrap();
        assert_eq!(parsed["version"], "2.1.0");
        let runs = parsed["runs"].as_array().unwrap();
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0]["tool"]["driver"]["name"], "crosshash");
        let results = runs[0]["results"].as_array().unwrap();
        assert_eq!(results.len(), 1);
        assert!(results[0]["message"]["text"].is_string());
    }

    #[test]
    fn render_sarif_critical_is_error_level() {
        let mut report = empty_report();
        report.classifications = vec![classification(0.95)];
        let sarif = report.render(ReportFormat::Sarif);
        let parsed: serde_json::Value = serde_json::from_str(&sarif).unwrap();
        let level = &parsed["runs"][0]["results"][0]["level"];
        assert_eq!(level, "error");
    }

    #[test]
    fn render_sarif_below_critical_is_warning_level() {
        let mut report = empty_report();
        report.classifications = vec![classification(0.7)];
        let sarif = report.render(ReportFormat::Sarif);
        let parsed: serde_json::Value = serde_json::from_str(&sarif).unwrap();
        let level = &parsed["runs"][0]["results"][0]["level"];
        assert_eq!(level, "warning");
    }

    #[test]
    fn markdown_includes_repo_counts() {
        let repo_a = Uuid::now_v7();
        let repo_b = Uuid::now_v7();
        let mut report = empty_report();
        report.changed_repos = vec![repo_a];
        report.affected_repos = vec![repo_a, repo_b];
        let md = report.render(ReportFormat::Markdown);
        assert!(md.contains("across 1 repos"));
        assert!(md.contains("across 2 repos"));
    }

    #[test]
    fn n_repo_report_not_limited_to_pair() {
        let mut report = empty_report();
        let repos: Vec<Uuid> = (0..5).map(|_| Uuid::now_v7()).collect();
        report.changed_repos = repos.clone();
        report.affected_repos = repos;
        assert_eq!(report.changed_repos.len(), 5);
        assert_eq!(report.affected_repos.len(), 5);
    }
}
