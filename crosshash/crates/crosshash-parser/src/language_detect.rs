use crosshash_core::{Language, Result};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Default)]
pub struct LanguageOverrides {
    by_extension: HashMap<String, Language>,
    by_path_suffix: HashMap<String, Language>,
}

impl LanguageOverrides {
    pub fn extension(mut self, extension: impl Into<String>, language: Language) -> Self {
        self.by_extension.insert(
            extension.into().trim_start_matches('.').to_string(),
            language,
        );
        self
    }

    pub fn path_suffix(mut self, suffix: impl Into<String>, language: Language) -> Self {
        self.by_path_suffix.insert(suffix.into(), language);
        self
    }
}

pub fn detect_language(path: &Path) -> Result<Option<Language>> {
    detect_language_with_overrides(path, &LanguageOverrides::default())
}

pub fn detect_language_with_overrides(
    path: &Path,
    overrides: &LanguageOverrides,
) -> Result<Option<Language>> {
    let path_text = path.to_string_lossy();
    if let Some((_, language)) = overrides
        .by_path_suffix
        .iter()
        .find(|(suffix, _)| path_text.ends_with(suffix.as_str()))
    {
        return Ok(Some(*language));
    }

    if let Some(ext) = path.extension().and_then(|ext| ext.to_str()) {
        if let Some(language) = overrides.by_extension.get(ext) {
            return Ok(Some(*language));
        }
        return Ok(match ext {
            "rs" => Some(Language::Rust),
            "ts" | "tsx" => Some(Language::TypeScript),
            "js" | "jsx" | "mjs" | "cjs" => Some(Language::JavaScript),
            "py" | "pyw" => Some(Language::Python),
            "go" => Some(Language::Go),
            "java" => Some(Language::Java),
            "c" | "h" => Some(Language::C),
            "cc" | "cpp" | "cxx" | "hpp" => Some(Language::Cpp),
            "cs" => Some(Language::CSharp),
            "rb" => Some(Language::Ruby),
            "php" => Some(Language::Php),
            "swift" => Some(Language::Swift),
            "kt" | "kts" => Some(Language::Kotlin),
            "scala" => Some(Language::Scala),
            "ex" | "exs" => Some(Language::Elixir),
            "dart" => Some(Language::Dart),
            "ml" | "mli" => Some(Language::Ocaml),
            "zig" => Some(Language::Zig),
            "sh" | "bash" | "zsh" => Some(Language::Bash),
            "html" | "htm" => Some(Language::Html),
            "css" => Some(Language::Css),
            _ => None,
        });
    }

    detect_shebang_language(path)
}

fn detect_shebang_language(path: &Path) -> Result<Option<Language>> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(_) => return Ok(None),
    };
    let first_line = bytes.split(|b| *b == b'\n').next().unwrap_or(&[]);
    if !first_line.starts_with(b"#!") {
        return Ok(None);
    }
    let shebang = String::from_utf8_lossy(first_line).to_ascii_lowercase();
    Ok(if shebang.contains("python") {
        Some(Language::Python)
    } else if shebang.contains("node") || shebang.contains("deno") || shebang.contains("bun") {
        Some(Language::JavaScript)
    } else {
        None
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn detects_twenty_plus_supported_language_extensions() {
        let cases = [
            ("src/lib.rs", Language::Rust),
            ("src/app.ts", Language::TypeScript),
            ("src/app.js", Language::JavaScript),
            ("script.py", Language::Python),
            ("main.go", Language::Go),
            ("Main.java", Language::Java),
            ("main.c", Language::C),
            ("main.cpp", Language::Cpp),
            ("Program.cs", Language::CSharp),
            ("app.rb", Language::Ruby),
            ("index.php", Language::Php),
            ("App.swift", Language::Swift),
            ("Main.kt", Language::Kotlin),
            ("App.scala", Language::Scala),
            ("mix.ex", Language::Elixir),
            ("main.dart", Language::Dart),
            ("core.ml", Language::Ocaml),
            ("main.zig", Language::Zig),
            ("script.sh", Language::Bash),
            ("index.html", Language::Html),
            ("style.css", Language::Css),
        ];
        for (path, language) in cases {
            assert_eq!(
                detect_language(Path::new(path)).unwrap(),
                Some(language),
                "{path}"
            );
        }
    }

    #[test]
    fn detects_rust_typescript_and_python_files() {
        assert_eq!(
            detect_language(Path::new("src/lib.rs")).unwrap(),
            Some(Language::Rust)
        );
        assert_eq!(
            detect_language(Path::new("src/app.ts")).unwrap(),
            Some(Language::TypeScript)
        );
        assert_eq!(
            detect_language(Path::new("script.py")).unwrap(),
            Some(Language::Python)
        );
    }

    #[test]
    fn skips_unknown_extensions() {
        assert_eq!(detect_language(Path::new("README.md")).unwrap(), None);
    }

    #[test]
    fn detects_extensionless_python_shebang() {
        let dir = tempfile::tempdir().unwrap();
        let script = dir.path().join("tool");
        fs::write(&script, "#!/usr/bin/env python3\nprint('x')\n").unwrap();
        assert_eq!(detect_language(&script).unwrap(), Some(Language::Python));
    }

    #[test]
    fn configurable_overrides_win_before_extension_mapping() {
        let overrides = LanguageOverrides::default().extension("txt", Language::Python);
        assert_eq!(
            detect_language_with_overrides(Path::new("script.txt"), &overrides).unwrap(),
            Some(Language::Python)
        );
    }
}
