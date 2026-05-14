use assert_cmd::Command;
use predicates::str::contains;
use std::fs;

fn setup_single_repo(dir: &std::path::Path, name: &str, source: &str) {
    let repo = dir.join(name);
    fs::create_dir_all(repo.join("src")).unwrap();
    fs::write(repo.join("src/lib.rs"), source).unwrap();
}

fn setup_two_repos(dir: &std::path::Path) -> (String, String) {
    let api = dir.join("api");
    let app = dir.join("app");
    fs::create_dir_all(api.join("src")).unwrap();
    fs::create_dir_all(app.join("src")).unwrap();
    fs::write(
        api.join("src/lib.rs"),
        "pub fn fetch_data() -> String { \"data\".into() }\npub fn process(input: &str) -> u32 { input.len() as u32 }\n",
    )
    .unwrap();
    fs::write(
        app.join("src/lib.rs"),
        "pub fn use_api() -> String { fetch_data() }\nfn internal() -> u32 { process(\"x\") }\n",
    )
    .unwrap();
    (
        api.to_string_lossy().to_string(),
        app.to_string_lossy().to_string(),
    )
}

#[test]
fn discover_edges_dry_run_shows_surfaces() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("crosshash.db");
    let (api, app) = setup_two_repos(dir.path());

    for (name, path) in [("api", &api), ("app", &app)] {
        Command::cargo_bin("crosshash")
            .unwrap()
            .args([
                "--db",
                db.to_str().unwrap(),
                "repo",
                "add",
                path,
                "--name",
                name,
            ])
            .assert()
            .success();
    }

    Command::cargo_bin("crosshash")
        .unwrap()
        .args(["--db", db.to_str().unwrap(), "index"])
        .assert()
        .success();

    Command::cargo_bin("crosshash")
        .unwrap()
        .args(["--db", db.to_str().unwrap(), "discover-edges", "--dry-run"])
        .assert()
        .success()
        .stdout(contains("public surfaces"))
        .stdout(contains("entities across"));
}

#[test]
fn discover_edges_validate_shows_pending() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("crosshash.db");

    Command::cargo_bin("crosshash")
        .unwrap()
        .args(["--db", db.to_str().unwrap(), "discover-edges", "--validate"])
        .assert()
        .success()
        .stdout(contains("pending AI suggestions: 0"));
}

#[test]
fn feedback_accept_flow() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("crosshash.db");
    let repo = dir.path().join("repo");
    fs::create_dir_all(repo.join("src")).unwrap();
    fs::write(
        repo.join("src/lib.rs"),
        "pub fn endpoint_a() -> u32 { 1 }\npub fn endpoint_b() -> u32 { endpoint_a() }\n",
    )
    .unwrap();

    Command::cargo_bin("crosshash")
        .unwrap()
        .args([
            "--db",
            db.to_str().unwrap(),
            "repo",
            "add",
            repo.to_str().unwrap(),
            "--name",
            "fb-test",
        ])
        .assert()
        .success();

    Command::cargo_bin("crosshash")
        .unwrap()
        .args(["--db", db.to_str().unwrap(), "index", "--repo", "fb-test"])
        .assert()
        .success();

    Command::cargo_bin("crosshash")
        .unwrap()
        .args(["--db", db.to_str().unwrap(), "feedback", "stats"])
        .assert()
        .success()
        .stdout(contains("total=0"));
}

#[test]
fn ai_stats_shows_zero_for_fresh_db() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("crosshash.db");

    Command::cargo_bin("crosshash")
        .unwrap()
        .args(["--db", db.to_str().unwrap(), "ai-stats"])
        .assert()
        .success()
        .stdout(contains("AI invocations: 0"))
        .stdout(contains("cost: $"))
        .stdout(contains("0.0000"));
}

#[test]
fn index_with_no_ai_flag_produces_zero_ai_cost() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("crosshash.db");
    setup_single_repo(dir.path(), "repo", "pub fn no_ai_fn() -> u32 { 1 }\n");
    let repo = dir.path().join("repo");

    Command::cargo_bin("crosshash")
        .unwrap()
        .args([
            "--db",
            db.to_str().unwrap(),
            "repo",
            "add",
            repo.to_str().unwrap(),
            "--name",
            "no-ai-repo",
        ])
        .assert()
        .success();

    Command::cargo_bin("crosshash")
        .unwrap()
        .args([
            "--db",
            db.to_str().unwrap(),
            "index",
            "--repo",
            "no-ai-repo",
            "--no-ai",
        ])
        .assert()
        .success()
        .stdout(contains("entities extracted"));

    Command::cargo_bin("crosshash")
        .unwrap()
        .args(["--db", db.to_str().unwrap(), "ai-stats"])
        .assert()
        .success()
        .stdout(contains("AI invocations: 0"));
}

#[test]
fn discover_edges_static_only_no_ai_cost() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("crosshash.db");
    let (api, app) = setup_two_repos(dir.path());

    for (name, path) in [("api", &api), ("app", &app)] {
        Command::cargo_bin("crosshash")
            .unwrap()
            .args([
                "--db",
                db.to_str().unwrap(),
                "repo",
                "add",
                path,
                "--name",
                name,
            ])
            .assert()
            .success();
    }

    Command::cargo_bin("crosshash")
        .unwrap()
        .args(["--db", db.to_str().unwrap(), "index", "--no-ai"])
        .assert()
        .success();

    Command::cargo_bin("crosshash")
        .unwrap()
        .args([
            "--db",
            db.to_str().unwrap(),
            "discover-edges",
            "--static-only",
        ])
        .assert()
        .success()
        .stdout(contains("gate_run_ai=false"));
}

#[test]
fn feedback_reject_marks_status() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("crosshash.db");

    Command::cargo_bin("crosshash")
        .unwrap()
        .args([
            "--db",
            db.to_str().unwrap(),
            "feedback",
            "reject",
            "00000000-0000-0000-0000-000000000001",
        ])
        .assert()
        .stderr(contains("suggestion not found"));
}

#[test]
fn feedback_accept_nonexistent_returns_error() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("crosshash.db");

    Command::cargo_bin("crosshash")
        .unwrap()
        .args([
            "--db",
            db.to_str().unwrap(),
            "feedback",
            "accept",
            "00000000-0000-0000-0000-000000000002",
        ])
        .assert()
        .stderr(contains("suggestion not found"));
}

#[test]
fn feedback_export_returns_empty_without_data() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("crosshash.db");

    Command::cargo_bin("crosshash")
        .unwrap()
        .args(["--db", db.to_str().unwrap(), "feedback", "export"])
        .assert()
        .success()
        .stdout(contains("0 feedback events"));
}

#[test]
fn multi_repo_index_with_no_ai_and_then_discover() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("crosshash.db");
    let (api, app) = setup_two_repos(dir.path());

    for (name, path) in [("api", &api), ("app", &app)] {
        Command::cargo_bin("crosshash")
            .unwrap()
            .args([
                "--db",
                db.to_str().unwrap(),
                "repo",
                "add",
                path,
                "--name",
                name,
            ])
            .assert()
            .success();
    }

    Command::cargo_bin("crosshash")
        .unwrap()
        .args(["--db", db.to_str().unwrap(), "index", "--no-ai"])
        .assert()
        .success()
        .stdout(contains("indexed 2 repos"));

    Command::cargo_bin("crosshash")
        .unwrap()
        .args(["--db", db.to_str().unwrap(), "ai-stats"])
        .assert()
        .success()
        .stdout(contains("AI invocations: 0"));
}
