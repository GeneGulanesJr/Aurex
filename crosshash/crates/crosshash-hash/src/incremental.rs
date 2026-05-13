use crate::hash_file_content;
use crosshash_core::Hash32;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileHashState {
    pub path: String,
    pub content_hash: Hash32,
    pub size: u64,
    pub modified_unix_ms: u128,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IncrementalDecision {
    ReusePrevious,
    Reparse,
}

pub fn decide_incremental(
    previous: Option<&FileHashState>,
    current_source: &str,
) -> IncrementalDecision {
    match previous {
        Some(prev) if prev.content_hash == hash_file_content(current_source) => {
            IncrementalDecision::ReusePrevious
        }
        _ => IncrementalDecision::Reparse,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unchanged_file_reuses_previous_hashes() {
        let source = "fn a() {}";
        let previous = FileHashState {
            path: "src/lib.rs".into(),
            content_hash: hash_file_content(source),
            size: source.len() as u64,
            modified_unix_ms: 1,
        };

        assert_eq!(
            decide_incremental(Some(&previous), source),
            IncrementalDecision::ReusePrevious
        );
    }

    #[test]
    fn changed_file_requires_reparse() {
        let previous = FileHashState {
            path: "src/lib.rs".into(),
            content_hash: hash_file_content("fn a() {}"),
            size: 9,
            modified_unix_ms: 1,
        };

        assert_eq!(
            decide_incremental(Some(&previous), "fn a() { println!(\"x\"); }"),
            IncrementalDecision::Reparse
        );
    }
}
