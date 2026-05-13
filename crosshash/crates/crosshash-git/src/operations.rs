use crosshash_core::{ChangeType, CommitHash, CoreError, FileDiff, Result};
use git2::{Delta, DiffOptions, Oid, Repository};
use std::path::Path;

pub fn get_head_commit(repo_path: &Path) -> Result<CommitHash> {
    let repo = open_repo(repo_path)?;
    let head = repo
        .head()
        .map_err(|e| CoreError::GitError(e.to_string()))?;
    let oid = head
        .target()
        .ok_or_else(|| CoreError::GitError("HEAD does not point to a commit".into()))?;
    Ok(oid.to_string())
}

pub fn get_file_at_commit(repo_path: &Path, commit: &str, file_path: &str) -> Result<String> {
    let repo = open_repo(repo_path)?;
    let oid = Oid::from_str(commit).map_err(|e| CoreError::GitError(e.to_string()))?;
    let commit = repo
        .find_commit(oid)
        .map_err(|e| CoreError::GitError(e.to_string()))?;
    let tree = commit
        .tree()
        .map_err(|e| CoreError::GitError(e.to_string()))?;
    let entry = tree
        .get_path(Path::new(file_path))
        .map_err(|e| CoreError::GitError(e.to_string()))?;
    let blob = repo
        .find_blob(entry.id())
        .map_err(|e| CoreError::GitError(e.to_string()))?;
    String::from_utf8(blob.content().to_vec()).map_err(|e| CoreError::GitError(e.to_string()))
}

pub fn get_changed_files(
    repo_path: &Path,
    old_commit: &str,
    new_commit: &str,
) -> Result<Vec<FileDiff>> {
    let repo = open_repo(repo_path)?;
    let old_tree = repo
        .find_commit(parse_oid(old_commit)?)
        .and_then(|c| c.tree())
        .map_err(|e| CoreError::GitError(e.to_string()))?;
    let new_tree = repo
        .find_commit(parse_oid(new_commit)?)
        .and_then(|c| c.tree())
        .map_err(|e| CoreError::GitError(e.to_string()))?;
    let diff = repo
        .diff_tree_to_tree(
            Some(&old_tree),
            Some(&new_tree),
            Some(DiffOptions::new().include_untracked(true)),
        )
        .map_err(|e| CoreError::GitError(e.to_string()))?;
    let mut files = Vec::new();
    for delta in diff.deltas() {
        let status = delta.status();
        let path = delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        let old_path = delta
            .old_file()
            .path()
            .map(|p| p.to_string_lossy().to_string());
        let change_type = match status {
            Delta::Added => ChangeType::Added,
            Delta::Deleted => ChangeType::Deleted,
            Delta::Renamed => ChangeType::Renamed,
            _ => ChangeType::Modified,
        };
        files.push(FileDiff {
            path,
            old_path,
            change_type,
        });
    }
    Ok(files)
}

pub fn get_merge_base(repo_path: &Path, ref_a: &str, ref_b: &str) -> Result<CommitHash> {
    let repo = open_repo(repo_path)?;
    let a = repo
        .revparse_single(ref_a)
        .map_err(|e| CoreError::GitError(e.to_string()))?
        .id();
    let b = repo
        .revparse_single(ref_b)
        .map_err(|e| CoreError::GitError(e.to_string()))?
        .id();
    Ok(repo
        .merge_base(a, b)
        .map_err(|e| CoreError::GitError(e.to_string()))?
        .to_string())
}

pub fn list_commits(repo_path: &Path, since_commit: &str) -> Result<Vec<CommitHash>> {
    let repo = open_repo(repo_path)?;
    let since = parse_oid(since_commit)?;
    let mut walk = repo
        .revwalk()
        .map_err(|e| CoreError::GitError(e.to_string()))?;
    walk.push_head()
        .map_err(|e| CoreError::GitError(e.to_string()))?;
    let mut commits = Vec::new();
    for oid in walk {
        let oid = oid.map_err(|e| CoreError::GitError(e.to_string()))?;
        if oid == since {
            break;
        }
        commits.push(oid.to_string());
    }
    Ok(commits)
}

fn open_repo(path: &Path) -> Result<Repository> {
    Repository::discover(path).map_err(|e| CoreError::GitError(e.to_string()))
}
fn parse_oid(value: &str) -> Result<Oid> {
    Oid::from_str(value).map_err(|e| CoreError::GitError(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::{Repository, Signature};
    use std::fs;

    fn commit_all(repo: &Repository, message: &str) -> String {
        let sig = Signature::now("CrossHash", "crosshash@example.test").unwrap();
        let mut index = repo.index().unwrap();
        index
            .add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
            .unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let parents = repo
            .head()
            .ok()
            .and_then(|h| h.target())
            .and_then(|id| repo.find_commit(id).ok())
            .into_iter()
            .collect::<Vec<_>>();
        let parent_refs = parents.iter().collect::<Vec<_>>();
        repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parent_refs)
            .unwrap()
            .to_string()
    }

    #[test]
    fn reads_files_and_changed_files_from_real_git_repo() {
        let dir = tempfile::tempdir().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        fs::write(dir.path().join("lib.rs"), "fn a() {}\n").unwrap();
        let first = commit_all(&repo, "first");
        fs::write(dir.path().join("lib.rs"), "fn a() {}\nfn b() {}\n").unwrap();
        let second = commit_all(&repo, "second");

        assert_eq!(get_head_commit(dir.path()).unwrap(), second);
        assert!(get_file_at_commit(dir.path(), &first, "lib.rs")
            .unwrap()
            .contains("fn a"));
        let changed = get_changed_files(dir.path(), &first, &second).unwrap();
        assert_eq!(changed.len(), 1);
        assert_eq!(changed[0].path, "lib.rs");
        assert_eq!(list_commits(dir.path(), &first).unwrap(), vec![second]);
    }
}
