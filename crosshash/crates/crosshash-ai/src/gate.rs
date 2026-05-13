use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GateInput {
    pub ai_enabled: bool,
    pub auto_gate: bool,
    pub no_ai: bool,
    pub force_ai: bool,
    pub new_repo: bool,
    pub exported_added: usize,
    pub exported_signature_changed: usize,
    pub exported_deleted: usize,
    pub body_only_changed: usize,
    pub commits_since_validation: u32,
    pub days_since_validation: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GateReason {
    Disabled,
    NoAiFlag,
    Forced,
    NewRepo,
    NewExports,
    SignatureChanged,
    ExportsDeleted,
    PeriodicRevalidation,
    BodyOnlyOnly,
    NoApiSurfaceChange,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GateDecision {
    pub should_run_ai: bool,
    pub reasons: Vec<GateReason>,
    pub scope: String,
}

pub struct AiGate;

impl AiGate {
    pub fn decide(input: &GateInput) -> GateDecision {
        if input.no_ai || !input.ai_enabled {
            return GateDecision {
                should_run_ai: false,
                reasons: vec![if input.no_ai {
                    GateReason::NoAiFlag
                } else {
                    GateReason::Disabled
                }],
                scope: "none".into(),
            };
        }
        if input.force_ai || !input.auto_gate {
            return GateDecision {
                should_run_ai: true,
                reasons: vec![GateReason::Forced],
                scope: "all".into(),
            };
        }
        if input.new_repo {
            return GateDecision {
                should_run_ai: true,
                reasons: vec![GateReason::NewRepo],
                scope: "all-existing-repos".into(),
            };
        }
        let mut reasons = Vec::new();
        if input.exported_added > 0 {
            reasons.push(GateReason::NewExports);
        }
        if input.exported_signature_changed > 0 {
            reasons.push(GateReason::SignatureChanged);
        }
        if input.exported_deleted > 0 {
            reasons.push(GateReason::ExportsDeleted);
        }
        if input.commits_since_validation >= 50 || input.days_since_validation >= 7 {
            reasons.push(GateReason::PeriodicRevalidation);
        }
        if reasons.is_empty() {
            reasons.push(if input.body_only_changed > 0 {
                GateReason::BodyOnlyOnly
            } else {
                GateReason::NoApiSurfaceChange
            });
            GateDecision {
                should_run_ai: false,
                reasons,
                scope: "none".into(),
            }
        } else {
            GateDecision {
                should_run_ai: true,
                scope: targeted_scope(&reasons).into(),
                reasons,
            }
        }
    }
}

fn targeted_scope(reasons: &[GateReason]) -> &'static str {
    if reasons.contains(&GateReason::ExportsDeleted) {
        "stale-ai-edges"
    } else if reasons.contains(&GateReason::SignatureChanged) {
        "changed-signatures-and-dependents"
    } else if reasons.contains(&GateReason::NewExports) {
        "new-exported-entities"
    } else {
        "all"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skips_ai_for_body_only_changes() {
        let d = AiGate::decide(&GateInput {
            ai_enabled: true,
            auto_gate: true,
            body_only_changed: 3,
            ..Default::default()
        });
        assert!(!d.should_run_ai);
        assert_eq!(d.reasons, vec![GateReason::BodyOnlyOnly]);
    }

    #[test]
    fn triggers_ai_for_new_repo_and_signature_changes() {
        assert!(
            AiGate::decide(&GateInput {
                ai_enabled: true,
                auto_gate: true,
                new_repo: true,
                ..Default::default()
            })
            .should_run_ai
        );
        let d = AiGate::decide(&GateInput {
            ai_enabled: true,
            auto_gate: true,
            exported_signature_changed: 1,
            ..Default::default()
        });
        assert!(d.should_run_ai);
        assert_eq!(d.scope, "changed-signatures-and-dependents");
    }
}
