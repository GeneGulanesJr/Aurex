use assert_cmd::Command;
use predicates::str::contains;
use std::fs;

fn add_repo(cmd_db: &str, name: &str, path: &str) {
    Command::cargo_bin("crosshash")
        .unwrap()
        .args(["--db", cmd_db, "repo", "add", path, "--name", name])
        .assert()
        .success();
}

fn index_repo(cmd_db: &str, name: &str) {
    Command::cargo_bin("crosshash")
        .unwrap()
        .args(["--db", cmd_db, "index", "--repo", name, "--no-ai"])
        .assert()
        .success();
}

mod subphase_71_language_expansion {
    use super::*;

    #[test]
    fn repo_add_detects_languages_from_source_files() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("lang-detect");
        fs::create_dir_all(&repo).unwrap();
        fs::write(repo.join("lib.rs"), "fn main() {}\n").unwrap();
        fs::write(repo.join("app.py"), "def main(): pass\n").unwrap();
        fs::write(repo.join("index.ts"), "export function main() {}\n").unwrap();
        let db = dir.path().join("test.db");

        Command::cargo_bin("crosshash")
            .unwrap()
            .args([
                "--db",
                db.to_str().unwrap(),
                "repo",
                "add",
                repo.to_str().unwrap(),
                "--name",
                "lang-detect",
            ])
            .assert()
            .success();

        Command::cargo_bin("crosshash")
            .unwrap()
            .args([
                "--db",
                db.to_str().unwrap(),
                "--format",
                "json",
                "repo",
                "info",
                "lang-detect",
            ])
            .assert()
            .success()
            .stdout(contains("Rust"))
            .stdout(contains("Python"))
            .stdout(contains("TypeScript"));
    }

    #[test]
    fn unsupported_languages_are_detected_but_not_extracted() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("go-repo");
        fs::create_dir_all(&repo).unwrap();
        fs::write(
            repo.join("main.go"),
            "package main\nfunc main() { println(\"hello\") }\n",
        )
        .unwrap();
        let db = dir.path().join("test.db");

        add_repo(db.to_str().unwrap(), "go-repo", repo.to_str().unwrap());

        Command::cargo_bin("crosshash")
            .unwrap()
            .args(["--db", db.to_str().unwrap(), "index", "--repo", "go-repo"])
            .assert()
            .failure()
            .stderr(contains("unsupported language"));
    }

    #[test]
    fn rust_entity_extraction_works_end_to_end() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("rust-svc");
        fs::create_dir_all(repo.join("src")).unwrap();
        fs::write(
            repo.join("src/lib.rs"),
            "pub fn public_fn() -> u32 { 1 }\nfn private_fn() -> u32 { public_fn() + 1 }\n",
        )
        .unwrap();
        let db = dir.path().join("test.db");

        add_repo(db.to_str().unwrap(), "rust-svc", repo.to_str().unwrap());
        index_repo(db.to_str().unwrap(), "rust-svc");

        Command::cargo_bin("crosshash")
            .unwrap()
            .args([
                "--db",
                db.to_str().unwrap(),
                "entity",
                "lookup",
                "public_fn",
                "--repo",
                "rust-svc",
            ])
            .assert()
            .success()
            .stdout(contains("public_fn"));

        Command::cargo_bin("crosshash")
            .unwrap()
            .args([
                "--db",
                db.to_str().unwrap(),
                "entity",
                "lookup",
                "private_fn",
                "--repo",
                "rust-svc",
            ])
            .assert()
            .success()
            .stdout(contains("private_fn"));
    }

    #[test]
    fn python_entity_extraction_works_end_to_end() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("py-svc");
        fs::create_dir_all(&repo).unwrap();
        fs::write(
            repo.join("main.py"),
            "def helper():\n    return 1\nclass MyClass:\n    def method(self):\n        return helper()\n",
        )
        .unwrap();
        let db = dir.path().join("test.db");

        add_repo(db.to_str().unwrap(), "py-svc", repo.to_str().unwrap());
        index_repo(db.to_str().unwrap(), "py-svc");

        Command::cargo_bin("crosshash")
            .unwrap()
            .args([
                "--db",
                db.to_str().unwrap(),
                "entity",
                "lookup",
                "helper",
                "--repo",
                "py-svc",
            ])
            .assert()
            .success()
            .stdout(contains("helper"));
    }

    #[test]
    fn typescript_entity_extraction_works_end_to_end() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("ts-svc");
        fs::create_dir_all(&repo).unwrap();
        fs::write(
            repo.join("index.ts"),
            "export function greet(name: string): string { return `Hello ${name}`; }\nfunction internal(): number { return 42; }\n",
        )
        .unwrap();
        let db = dir.path().join("test.db");

        add_repo(db.to_str().unwrap(), "ts-svc", repo.to_str().unwrap());
        index_repo(db.to_str().unwrap(), "ts-svc");

        Command::cargo_bin("crosshash")
            .unwrap()
            .args([
                "--db",
                db.to_str().unwrap(),
                "entity",
                "lookup",
                "greet",
                "--repo",
                "ts-svc",
            ])
            .assert()
            .success()
            .stdout(contains("greet"));
    }
}

mod subphase_72_performance_optimization {
    use super::*;

    #[test]
    fn incremental_reindex_skips_unchanged_files() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("inc-svc");
        fs::create_dir_all(repo.join("src")).unwrap();
        fs::write(repo.join("src/lib.rs"), "pub fn stable_fn() -> u32 { 1 }\n").unwrap();
        let db = dir.path().join("test.db");

        add_repo(db.to_str().unwrap(), "inc-svc", repo.to_str().unwrap());
        index_repo(db.to_str().unwrap(), "inc-svc");

        Command::cargo_bin("crosshash")
            .unwrap()
            .args([
                "--db",
                db.to_str().unwrap(),
                "index",
                "--repo",
                "inc-svc",
                "--incremental",
                "--no-ai",
            ])
            .assert()
            .success()
            .stdout(contains("files skipped"));
    }

    #[test]
    fn reindex_after_modification_re_parses_changed_file() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("mod-svc");
        fs::create_dir_all(repo.join("src")).unwrap();
        fs::write(repo.join("src/lib.rs"), "pub fn original() -> u32 { 1 }\n").unwrap();
        let db = dir.path().join("test.db");

        add_repo(db.to_str().unwrap(), "mod-svc", repo.to_str().unwrap());
        index_repo(db.to_str().unwrap(), "mod-svc");

        fs::write(
            repo.join("src/lib.rs"),
            "pub fn modified() -> u32 { 2 }\npub fn added() -> u32 { 3 }\n",
        )
        .unwrap();

        Command::cargo_bin("crosshash")
            .unwrap()
            .args([
                "--db",
                db.to_str().unwrap(),
                "index",
                "--repo",
                "mod-svc",
                "--incremental",
                "--no-ai",
            ])
            .assert()
            .success()
            .stdout(contains("files parsed"));

        Command::cargo_bin("crosshash")
            .unwrap()
            .args([
                "--db",
                db.to_str().unwrap(),
                "entity",
                "lookup",
                "added",
                "--repo",
                "mod-svc",
            ])
            .assert()
            .success()
            .stdout(contains("added"));
    }

    #[test]
    fn parallel_parsing_handles_multiple_files() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("multi-file");
        fs::create_dir_all(repo.join("src")).unwrap();
        for i in 0..5 {
            fs::write(
                repo.join(format!("src/mod{i}.rs")),
                format!("pub fn fn_{i}() -> u32 {{ {i} }}\n"),
            )
            .unwrap();
        }
        let db = dir.path().join("test.db");

        add_repo(db.to_str().unwrap(), "multi-file", repo.to_str().unwrap());
        index_repo(db.to_str().unwrap(), "multi-file");

        for i in 0..5 {
            Command::cargo_bin("crosshash")
                .unwrap()
                .args([
                    "--db",
                    db.to_str().unwrap(),
                    "entity",
                    "lookup",
                    &format!("fn_{i}"),
                    "--repo",
                    "multi-file",
                ])
                .assert()
                .success()
                .stdout(contains(format!("fn_{i}")));
        }
    }

    #[test]
    fn wal_mode_provides_concurrent_read_during_write() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("wal-svc");
        fs::create_dir_all(repo.join("src")).unwrap();
        fs::write(repo.join("src/lib.rs"), "pub fn wal_fn() -> u32 { 1 }\n").unwrap();
        let db = dir.path().join("test.db");

        add_repo(db.to_str().unwrap(), "wal-svc", repo.to_str().unwrap());
        index_repo(db.to_str().unwrap(), "wal-svc");

        Command::cargo_bin("crosshash")
            .unwrap()
            .args(["--db", db.to_str().unwrap(), "repo", "info", "wal-svc"])
            .assert()
            .success()
            .stdout(contains("wal-svc"));
    }
}

mod subphase_75_advanced_features {
    use super::*;

    #[test]
    fn entity_version_round_trip_via_index() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("ver-svc");
        fs::create_dir_all(repo.join("src")).unwrap();
        fs::write(
            repo.join("src/lib.rs"),
            "pub fn versioned_fn() -> u32 { 1 }\n",
        )
        .unwrap();
        let db = dir.path().join("test.db");

        add_repo(db.to_str().unwrap(), "ver-svc", repo.to_str().unwrap());
        index_repo(db.to_str().unwrap(), "ver-svc");

        Command::cargo_bin("crosshash")
            .unwrap()
            .args([
                "--db",
                db.to_str().unwrap(),
                "entity",
                "hash",
                "versioned_fn",
                "--repo",
                "ver-svc",
            ])
            .assert()
            .success()
            .stdout(contains("signature:"))
            .stdout(contains("content:"))
            .stdout(contains("structural:"))
            .stdout(contains("identity:"))
            .stdout(contains("context:"));
    }

    #[test]
    fn structural_diff_via_impact_analysis() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("diff-svc");
        fs::create_dir_all(repo.join("src")).unwrap();
        fs::write(
            repo.join("src/lib.rs"),
            "pub fn target_fn() -> u32 { helper() }\nfn helper() -> u32 { 1 }\n",
        )
        .unwrap();
        let db = dir.path().join("test.db");

        add_repo(db.to_str().unwrap(), "diff-svc", repo.to_str().unwrap());
        index_repo(db.to_str().unwrap(), "diff-svc");

        Command::cargo_bin("crosshash")
            .unwrap()
            .args([
                "--db",
                db.to_str().unwrap(),
                "impact",
                "--entity",
                "target_fn",
                "--output",
                "json",
            ])
            .assert()
            .success()
            .stdout(contains("changed_entities"));
    }

    #[test]
    fn graph_traversal_path_between_works() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("path-svc");
        fs::create_dir_all(repo.join("src")).unwrap();
        fs::write(
            repo.join("src/lib.rs"),
            "pub fn top() -> u32 { middle() }\nfn middle() -> u32 { bottom() }\nfn bottom() -> u32 { 1 }\n",
        )
        .unwrap();
        let db = dir.path().join("test.db");

        add_repo(db.to_str().unwrap(), "path-svc", repo.to_str().unwrap());
        index_repo(db.to_str().unwrap(), "path-svc");

        Command::cargo_bin("crosshash")
            .unwrap()
            .args([
                "--db",
                db.to_str().unwrap(),
                "graph",
                "path-between",
                "top",
                "bottom",
                "--repo",
                "path-svc",
            ])
            .assert()
            .success();
    }

    #[test]
    fn blast_radius_finds_transitive_callers() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("blast-svc");
        fs::create_dir_all(repo.join("src")).unwrap();
        fs::write(
            repo.join("src/lib.rs"),
            "pub fn deep_fn() -> u32 { 1 }\npub fn mid_fn() -> u32 { deep_fn() }\npub fn top_fn() -> u32 { mid_fn() }\n",
        )
        .unwrap();
        let db = dir.path().join("test.db");

        add_repo(db.to_str().unwrap(), "blast-svc", repo.to_str().unwrap());
        index_repo(db.to_str().unwrap(), "blast-svc");

        Command::cargo_bin("crosshash")
            .unwrap()
            .args([
                "--db",
                db.to_str().unwrap(),
                "graph",
                "blast-radius",
                "deep_fn",
                "--repo",
                "blast-svc",
            ])
            .assert()
            .success()
            .stdout(contains("top_fn"))
            .stdout(contains("mid_fn"));
    }

    #[test]
    fn edge_staleness_validation_works_after_index() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("stale-svc");
        fs::create_dir_all(repo.join("src")).unwrap();
        fs::write(
            repo.join("src/lib.rs"),
            "pub fn stable_api() -> u32 { 1 }\npub fn uses_api() -> u32 { stable_api() }\n",
        )
        .unwrap();
        let db = dir.path().join("test.db");

        add_repo(db.to_str().unwrap(), "stale-svc", repo.to_str().unwrap());
        index_repo(db.to_str().unwrap(), "stale-svc");

        Command::cargo_bin("crosshash")
            .unwrap()
            .args([
                "--db",
                db.to_str().unwrap(),
                "graph",
                "validate-edges",
                "--repo",
                "stale-svc",
            ])
            .assert()
            .success()
            .stdout(contains("stale edges: 0"));
    }

    #[test]
    fn cycle_detection_on_cyclic_code() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("cycle-svc");
        fs::create_dir_all(repo.join("src")).unwrap();
        fs::write(
            repo.join("src/lib.rs"),
            "pub fn a() -> u32 { b() }\npub fn b() -> u32 { c() }\npub fn c() -> u32 { a() }\n",
        )
        .unwrap();
        let db = dir.path().join("test.db");

        add_repo(db.to_str().unwrap(), "cycle-svc", repo.to_str().unwrap());
        index_repo(db.to_str().unwrap(), "cycle-svc");

        Command::cargo_bin("crosshash")
            .unwrap()
            .args([
                "--db",
                db.to_str().unwrap(),
                "graph",
                "cycles",
                "--repo",
                "cycle-svc",
            ])
            .assert()
            .success();
    }
}

mod subphase_76_release_hardening {
    use super::*;

    #[test]
    fn crosshash_help_shows_all_commands() {
        Command::cargo_bin("crosshash")
            .unwrap()
            .arg("--help")
            .assert()
            .success()
            .stdout(contains("repo"))
            .stdout(contains("index"))
            .stdout(contains("entity"))
            .stdout(contains("graph"))
            .stdout(contains("impact"))
            .stdout(contains("discover-edges"))
            .stdout(contains("feedback"))
            .stdout(contains("ai-stats"));
    }

    #[test]
    fn multi_repo_end_to_end_index_and_query() {
        let dir = tempfile::tempdir().unwrap();
        let core = dir.path().join("core-lib");
        let consumer = dir.path().join("consumer-app");
        fs::create_dir_all(core.join("src")).unwrap();
        fs::create_dir_all(consumer.join("src")).unwrap();
        fs::write(
            core.join("src/lib.rs"),
            "pub fn shared_util() -> u32 { 1 }\npub fn shared_helper() -> u32 { shared_util() + 1 }\n",
        )
        .unwrap();
        fs::write(
            consumer.join("src/lib.rs"),
            "pub fn app_fn() -> u32 { shared_util() + shared_helper() }\n",
        )
        .unwrap();
        let db = dir.path().join("test.db");

        add_repo(db.to_str().unwrap(), "core-lib", core.to_str().unwrap());
        add_repo(
            db.to_str().unwrap(),
            "consumer-app",
            consumer.to_str().unwrap(),
        );

        Command::cargo_bin("crosshash")
            .unwrap()
            .args(["--db", db.to_str().unwrap(), "index", "--no-ai"])
            .assert()
            .success()
            .stdout(contains("indexed 2 repos"));

        Command::cargo_bin("crosshash")
            .unwrap()
            .args([
                "--db",
                db.to_str().unwrap(),
                "graph",
                "callers",
                "shared_util",
                "--repo",
                "core-lib",
                "--cross-repo",
            ])
            .assert()
            .success()
            .stdout(contains("shared_helper"));

        Command::cargo_bin("crosshash")
            .unwrap()
            .args([
                "--db",
                db.to_str().unwrap(),
                "impact",
                "--entity",
                "shared_util",
                "--output",
                "json",
            ])
            .assert()
            .success()
            .stdout(contains("changed_entities"));
    }

    #[test]
    fn impact_output_formats_json_markdown_sarif() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("fmt-svc");
        fs::create_dir_all(repo.join("src")).unwrap();
        fs::write(repo.join("src/lib.rs"), "pub fn fmt_fn() -> u32 { 42 }\n").unwrap();
        let db = dir.path().join("test.db");

        add_repo(db.to_str().unwrap(), "fmt-svc", repo.to_str().unwrap());
        index_repo(db.to_str().unwrap(), "fmt-svc");

        Command::cargo_bin("crosshash")
            .unwrap()
            .args([
                "--db",
                db.to_str().unwrap(),
                "impact",
                "--entity",
                "fmt_fn",
                "--output",
                "json",
            ])
            .assert()
            .success()
            .stdout(contains("changed_entities"));

        Command::cargo_bin("crosshash")
            .unwrap()
            .args([
                "--db",
                db.to_str().unwrap(),
                "impact",
                "--entity",
                "fmt_fn",
                "--output",
                "markdown",
            ])
            .assert()
            .success()
            .stdout(contains("CrossHash Impact Report"));

        Command::cargo_bin("crosshash")
            .unwrap()
            .args([
                "--db",
                db.to_str().unwrap(),
                "impact",
                "--entity",
                "fmt_fn",
                "--output",
                "sarif",
            ])
            .assert()
            .success();
    }

    #[test]
    fn repo_remove_cleans_up_entities_and_edges() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("rm-svc");
        fs::create_dir_all(repo.join("src")).unwrap();
        fs::write(repo.join("src/lib.rs"), "pub fn to_remove() -> u32 { 1 }\n").unwrap();
        let db = dir.path().join("test.db");

        add_repo(db.to_str().unwrap(), "rm-svc", repo.to_str().unwrap());
        index_repo(db.to_str().unwrap(), "rm-svc");

        Command::cargo_bin("crosshash")
            .unwrap()
            .args(["--db", db.to_str().unwrap(), "repo", "remove", "rm-svc"])
            .assert()
            .success();

        Command::cargo_bin("crosshash")
            .unwrap()
            .args(["--db", db.to_str().unwrap(), "repo", "list"])
            .assert()
            .success()
            .stdout(contains("no repos"));
    }

    #[test]
    fn entity_hash_consistency_across_reindexes() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("hash-svc");
        fs::create_dir_all(repo.join("src")).unwrap();
        fs::write(
            repo.join("src/lib.rs"),
            "pub fn hash_target() -> u32 { 1 }\n",
        )
        .unwrap();
        let db = dir.path().join("test.db");

        add_repo(db.to_str().unwrap(), "hash-svc", repo.to_str().unwrap());
        index_repo(db.to_str().unwrap(), "hash-svc");

        let first_output = String::from_utf8(
            Command::cargo_bin("crosshash")
                .unwrap()
                .args([
                    "--db",
                    db.to_str().unwrap(),
                    "--format",
                    "json",
                    "entity",
                    "hash",
                    "hash_target",
                    "--repo",
                    "hash-svc",
                ])
                .assert()
                .success()
                .get_output()
                .stdout
                .clone(),
        )
        .unwrap();

        Command::cargo_bin("crosshash")
            .unwrap()
            .args([
                "--db",
                db.to_str().unwrap(),
                "index",
                "--repo",
                "hash-svc",
                "--no-ai",
            ])
            .assert()
            .success();

        let second_output = String::from_utf8(
            Command::cargo_bin("crosshash")
                .unwrap()
                .args([
                    "--db",
                    db.to_str().unwrap(),
                    "--format",
                    "json",
                    "entity",
                    "hash",
                    "hash_target",
                    "--repo",
                    "hash-svc",
                ])
                .assert()
                .success()
                .get_output()
                .stdout
                .clone(),
        )
        .unwrap();

        assert_eq!(first_output, second_output);
    }

    #[test]
    fn ai_stats_zero_cost_without_ai_calls() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("zero-ai");
        fs::create_dir_all(repo.join("src")).unwrap();
        fs::write(repo.join("src/lib.rs"), "pub fn no_ai() -> u32 { 1 }\n").unwrap();
        let db = dir.path().join("test.db");

        add_repo(db.to_str().unwrap(), "zero-ai", repo.to_str().unwrap());
        index_repo(db.to_str().unwrap(), "zero-ai");

        Command::cargo_bin("crosshash")
            .unwrap()
            .args(["--db", db.to_str().unwrap(), "ai-stats"])
            .assert()
            .success()
            .stdout(contains("AI invocations: 0"))
            .stdout(contains("0.0000"));
    }
}
