use crosshash_core::Result;
use std::path::Path;

use crate::operations::get_file_at_commit;

pub fn entity_source_at_commit(repo_path: &Path, commit: &str, file_path: &str) -> Result<String> {
    get_file_at_commit(repo_path, commit, file_path)
}
