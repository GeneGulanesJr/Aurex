use crosshash_core::{Entity, Result};
use std::path::Path;
use tree_sitter::Tree;
use uuid::Uuid;

pub trait EntityExtractor {
    fn extract_entities(
        &self,
        repo_id: Uuid,
        repo_root: &Path,
        file_path: &Path,
        source: &str,
        tree: &Tree,
        commit_hash: &str,
    ) -> Result<Vec<Entity>>;
}
