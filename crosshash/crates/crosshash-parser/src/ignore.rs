use crate::language_detect::detect_language;
use crosshash_core::{CoreError, Language, Result};
use ignore::WalkBuilder;
use std::fs;
use std::path::{Path, PathBuf};

const HARD_SKIPS: &[&str] = &["node_modules", "target", "vendor", ".git", "dist", "build"];
const BINARY_EXTENSIONS: &[&str] = &[
    "a", "bin", "dll", "dylib", "exe", "gif", "ico", "jpg", "jpeg", "o", "pdf", "png", "so",
    "wasm", "webp", "zip",
];

#[derive(Debug, Clone, Default)]
pub struct FileFilterConfig {
    pub include_languages: Vec<Language>,
}

pub fn collect_source_files(root: &Path, languages: &[Language]) -> Result<Vec<PathBuf>> {
    let mut files = Vec::new();
    let walker = WalkBuilder::new(root)
        .hidden(false)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .add_custom_ignore_filename(".crosshashignore")
        .filter_entry(|entry| {
            let name = entry.file_name().to_string_lossy();
            !HARD_SKIPS.contains(&name.as_ref())
        })
        .build();

    for result in walker {
        let entry = result.map_err(|e| CoreError::Io(e.to_string()))?;
        if !entry.file_type().map(|ft| ft.is_file()).unwrap_or(false) {
            continue;
        }
        let path = entry.path();
        if is_known_binary_extension(path) || has_null_byte(path)? {
            continue;
        }
        let Some(language) = detect_language(path)? else {
            continue;
        };
        if languages.is_empty() || languages.contains(&language) {
            files.push(path.to_path_buf());
        }
    }

    files.sort();
    Ok(files)
}

pub fn collect_rust_files(root: &Path) -> Result<Vec<PathBuf>> {
    collect_source_files(root, &[Language::Rust])
}

fn is_known_binary_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| BINARY_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn has_null_byte(path: &Path) -> Result<bool> {
    let bytes = fs::read(path).map_err(|e| CoreError::Io(e.to_string()))?;
    Ok(bytes.iter().take(8192).any(|b| *b == 0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn collects_source_files_and_skips_target() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("src")).unwrap();
        fs::create_dir_all(dir.path().join("target/debug")).unwrap();
        fs::write(dir.path().join("src/lib.rs"), "fn main() {}").unwrap();
        fs::write(dir.path().join("src/app.ts"), "export function f() {}").unwrap();
        fs::write(dir.path().join("target/debug/build.rs"), "fn ignored() {}").unwrap();

        let files =
            collect_source_files(dir.path(), &[Language::Rust, Language::TypeScript]).unwrap();
        assert_eq!(files.len(), 2);
        assert!(files.iter().any(|f| f.ends_with("src/lib.rs")));
        assert!(files.iter().any(|f| f.ends_with("src/app.ts")));
    }

    #[test]
    fn respects_crosshashignore_and_binary_null_bytes() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(".crosshashignore"), "ignored.py\n").unwrap();
        fs::write(dir.path().join("kept.py"), "def kept():\n    pass\n").unwrap();
        fs::write(dir.path().join("ignored.py"), "def ignored():\n    pass\n").unwrap();
        fs::write(dir.path().join("bad.py"), b"def bad():\0").unwrap();

        let files = collect_source_files(dir.path(), &[Language::Python]).unwrap();
        assert_eq!(files.len(), 1);
        assert!(files[0].ends_with("kept.py"));
    }
}
