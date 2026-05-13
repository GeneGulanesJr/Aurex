pub mod analyzer;
pub mod classify;
pub mod diff;
pub mod report;

pub use analyzer::{AffectedEntity, ImpactAnalyzer, ImpactPathStep};
pub use classify::{ImpactClassification, ImpactClassifier};
pub use diff::{diff_entities, ChangeKind, ChangedEntity};
pub use report::{ImpactReportBuilder, ReportFormat};
