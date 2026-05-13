use assert_cmd::Command;
use predicates::str::contains;
use std::fs;

#[test]
fn crosshash_help_lists_phase_one_commands() {
    let mut cmd = Command::cargo_bin("crosshash").unwrap();
    cmd.arg("--help")
        .assert()
        .success()
        .stdout(contains("repo"))
        .stdout(contains("index"))
        .stdout(contains("discover-edges"))
        .stdout(contains("impact"))
        .stdout(contains("entity"))
        .stdout(contains("graph"))
        .stdout(contains("feedback"))
        .stdout(contains("ai-stats"));
}

#[test]
fn repo_list_uses_storage() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("crosshash.db");
    let mut cmd = Command::cargo_bin("crosshash").unwrap();
    cmd.args(["--db", db.to_str().unwrap(), "repo", "list"])
        .assert()
        .success()
        .stdout(contains("no repos"));
}

#[test]
fn repo_add_index_and_entity_lookup_work_end_to_end() {
    let dir = tempfile::tempdir().unwrap();
    let repo = dir.path().join("repo");
    fs::create_dir_all(repo.join("src")).unwrap();
    fs::write(
        repo.join("src/lib.rs"),
        "pub fn phase_one() -> u32 { helper() }\nfn helper() -> u32 { 1 }\n",
    )
    .unwrap();
    let db = dir.path().join("crosshash.db");

    Command::cargo_bin("crosshash")
        .unwrap()
        .args([
            "--db",
            db.to_str().unwrap(),
            "repo",
            "add",
            repo.to_str().unwrap(),
            "--name",
            "my-service",
        ])
        .assert()
        .success()
        .stdout(contains("added repo my-service"));

    Command::cargo_bin("crosshash")
        .unwrap()
        .args([
            "--db",
            db.to_str().unwrap(),
            "index",
            "--repo",
            "my-service",
        ])
        .assert()
        .success()
        .stdout(contains("entities extracted"));

    Command::cargo_bin("crosshash")
        .unwrap()
        .args([
            "--db",
            db.to_str().unwrap(),
            "entity",
            "lookup",
            "phase_one",
            "--repo",
            "my-service",
        ])
        .assert()
        .success()
        .stdout(contains("phase_one"));

    Command::cargo_bin("crosshash")
        .unwrap()
        .args([
            "--db",
            db.to_str().unwrap(),
            "entity",
            "hash",
            "phase_one",
            "--repo",
            "my-service",
        ])
        .assert()
        .success()
        .stdout(contains("signature:"));

    Command::cargo_bin("crosshash")
        .unwrap()
        .args([
            "--db",
            db.to_str().unwrap(),
            "graph",
            "callees",
            "phase_one",
            "--repo",
            "my-service",
        ])
        .assert()
        .success()
        .stdout(contains("helper"));

    Command::cargo_bin("crosshash")
        .unwrap()
        .args([
            "--db",
            db.to_str().unwrap(),
            "graph",
            "callers",
            "helper",
            "--repo",
            "my-service",
        ])
        .assert()
        .success()
        .stdout(contains("phase_one"));

    Command::cargo_bin("crosshash")
        .unwrap()
        .args([
            "--db",
            db.to_str().unwrap(),
            "graph",
            "cycles",
            "--repo",
            "my-service",
        ])
        .assert()
        .success()
        .stdout(contains("no cycles"));

    Command::cargo_bin("crosshash")
        .unwrap()
        .args([
            "--db",
            db.to_str().unwrap(),
            "index",
            "--repo",
            "my-service",
            "--incremental",
        ])
        .assert()
        .success()
        .stdout(contains("files skipped"));
}

#[test]
fn multi_repo_index_and_cross_repo_graph_queries_work() {
    let dir = tempfile::tempdir().unwrap();
    let api = dir.path().join("api");
    let app = dir.path().join("app");
    fs::create_dir_all(api.join("src")).unwrap();
    fs::create_dir_all(app.join("src")).unwrap();
    fs::write(api.join("src/lib.rs"), "pub fn shared_api() -> u32 { 1 }\n").unwrap();
    fs::write(
        app.join("src/lib.rs"),
        "pub fn use_api() -> u32 { shared_api() }\n",
    )
    .unwrap();
    let db = dir.path().join("crosshash.db");

    for (name, path) in [("api", &api), ("app", &app)] {
        Command::cargo_bin("crosshash")
            .unwrap()
            .args([
                "--db",
                db.to_str().unwrap(),
                "repo",
                "add",
                path.to_str().unwrap(),
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
        .success()
        .stdout(contains("indexed 2 repos"));

    Command::cargo_bin("crosshash")
        .unwrap()
        .args(["--db", db.to_str().unwrap(), "repo", "info", "api"])
        .assert()
        .success()
        .stdout(contains("exports: 1"));

    Command::cargo_bin("crosshash")
        .unwrap()
        .args([
            "--db",
            db.to_str().unwrap(),
            "entity",
            "lookup",
            "shared_api",
            "--all",
        ])
        .assert()
        .success()
        .stdout(contains("shared_api"));

    Command::cargo_bin("crosshash")
        .unwrap()
        .args([
            "--db",
            db.to_str().unwrap(),
            "graph",
            "callers",
            "shared_api",
            "--repo",
            "api",
            "--cross-repo",
        ])
        .assert()
        .success()
        .stdout(contains("use_api"));

    Command::cargo_bin("crosshash")
        .unwrap()
        .args([
            "--db",
            db.to_str().unwrap(),
            "graph",
            "validate-edges",
            "--repo",
            "api",
        ])
        .assert()
        .success()
        .stdout(contains("stale edges: 0"));
}
