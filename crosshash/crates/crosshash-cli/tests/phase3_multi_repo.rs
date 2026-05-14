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

fn index_all(cmd_db: &str) {
    Command::cargo_bin("crosshash")
        .unwrap()
        .args(["--db", cmd_db, "index", "--no-ai"])
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

fn setup_two_repos(
    dir: &std::path::Path,
) -> (String, String) {
    let api = dir.join("aaa-core");
    let app = dir.join("bbb-app");
    fs::create_dir_all(api.join("src")).unwrap();
    fs::create_dir_all(app.join("src")).unwrap();

    fs::write(
        api.join("src/lib.rs"),
        "pub fn shared_api() -> u32 { 1 }\npub fn shared_helper() -> u32 { shared_api() + 1 }\n",
    )
    .unwrap();
    fs::write(
        app.join("src/lib.rs"),
        "pub fn use_api() -> u32 { shared_api() }\nfn internal() -> u32 { shared_helper() }\n",
    )
    .unwrap();

    (
        api.to_string_lossy().to_string(),
        app.to_string_lossy().to_string(),
    )
}

fn setup_three_repos(
    dir: &std::path::Path,
) -> (String, String, String) {
    let core = dir.join("aaa-core");
    let mid = dir.join("bbb-mid");
    let app = dir.join("ccc-app");
    fs::create_dir_all(core.join("src")).unwrap();
    fs::create_dir_all(mid.join("src")).unwrap();
    fs::create_dir_all(app.join("src")).unwrap();

    fs::write(
        core.join("src/lib.rs"),
        "pub fn core_util() -> u32 { 1 }\npub fn core_helper() -> u32 { core_util() + 1 }\n",
    )
    .unwrap();
    fs::write(
        mid.join("src/lib.rs"),
        "pub fn mid_fn() -> u32 { core_util() }\npub fn mid_extra() -> u32 { 3 }\n",
    )
    .unwrap();
    fs::write(
        app.join("src/lib.rs"),
        "pub fn app_main() -> u32 { core_util() + mid_fn() }\nfn app_internal() -> u32 { core_helper() }\n",
    )
    .unwrap();

    (
        core.to_string_lossy().to_string(),
        mid.to_string_lossy().to_string(),
        app.to_string_lossy().to_string(),
    )
}

mod subphase_31_repo_registry {
    use super::*;

    #[test]
    fn repo_add_list_remove_info_cycle() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("svc");
        fs::create_dir_all(repo.join("src")).unwrap();
        fs::write(repo.join("src/lib.rs"), "pub fn hello() -> u32 { 1 }\n").unwrap();
        let db = dir.path().join("test.db");

        add_repo(db.to_str().unwrap(), "svc", repo.to_str().unwrap());

        Command::cargo_bin("crosshash")
            .unwrap()
            .args(["--db", db.to_str().unwrap(), "repo", "list"])
            .assert()
            .success()
            .stdout(contains("svc"));

        Command::cargo_bin("crosshash")
            .unwrap()
            .args(["--db", db.to_str().unwrap(), "repo", "info", "svc"])
            .assert()
            .success()
            .stdout(contains("svc"))
            .stdout(contains("workspace:"))
            .stdout(contains("entities: 0"));

        Command::cargo_bin("crosshash")
            .unwrap()
            .args(["--db", db.to_str().unwrap(), "repo", "remove", "svc"])
            .assert()
            .success()
            .stdout(contains("removed repo svc"));

        Command::cargo_bin("crosshash")
            .unwrap()
            .args(["--db", db.to_str().unwrap(), "repo", "list"])
            .assert()
            .success()
            .stdout(contains("no repos"));
    }

    #[test]
    fn repo_add_detects_languages_from_source_files() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("polyglot");
        fs::create_dir_all(repo.join("src")).unwrap();
        fs::write(repo.join("src/lib.rs"), "pub fn rust_fn() -> u32 { 1 }\n").unwrap();
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
                "polyglot",
            ])
            .assert()
            .success()
            .stdout(contains("added repo polyglot"));

        Command::cargo_bin("crosshash")
            .unwrap()
            .args([
                "--db",
                db.to_str().unwrap(),
                "--format",
                "json",
                "repo",
                "info",
                "polyglot",
            ])
            .assert()
            .success()
            .stdout(contains("Rust"));
    }

    #[test]
    fn repo_info_after_index_shows_entity_and_export_counts() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("svc");
        fs::create_dir_all(repo.join("src")).unwrap();
        fs::write(
            repo.join("src/lib.rs"),
            "pub fn exported_fn() -> u32 { private_fn() }\nfn private_fn() -> u32 { 1 }\n",
        )
        .unwrap();
        let db = dir.path().join("test.db");

        add_repo(db.to_str().unwrap(), "svc", repo.to_str().unwrap());
        index_repo(db.to_str().unwrap(), "svc");

        Command::cargo_bin("crosshash")
            .unwrap()
            .args(["--db", db.to_str().unwrap(), "repo", "info", "svc"])
            .assert()
            .success()
            .stdout(contains("entities: 2"))
            .stdout(contains("exports: 1"));
    }

    #[test]
    fn repo_remove_cascades_entities_and_edges() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("svc");
        fs::create_dir_all(repo.join("src")).unwrap();
        fs::write(
            repo.join("src/lib.rs"),
            "pub fn a() -> u32 { b() }\npub fn b() -> u32 { 1 }\n",
        )
        .unwrap();
        let db = dir.path().join("test.db");

        add_repo(db.to_str().unwrap(), "svc", repo.to_str().unwrap());
        index_repo(db.to_str().unwrap(), "svc");

        Command::cargo_bin("crosshash")
            .unwrap()
            .args(["--db", db.to_str().unwrap(), "repo", "remove", "svc"])
            .assert()
            .success();

        Command::cargo_bin("crosshash")
            .unwrap()
            .args(["--db", db.to_str().unwrap(), "entity", "lookup", "a", "--all"])
            .assert()
            .success()
            .stdout(contains("no entities"));
    }
}

mod subphase_32_workspace_detection {
    use super::*;

    #[test]
    fn detects_cargo_workspace_when_workspace_aware() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("ws");
        fs::create_dir_all(repo.join("src")).unwrap();
        fs::write(
            repo.join("Cargo.toml"),
            "[workspace]\nmembers = [\"crates/*\"]\n",
        )
        .unwrap();
        fs::write(repo.join("src/lib.rs"), "pub fn ws_fn() -> u32 { 1 }\n").unwrap();
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
                "ws",
                "--workspace-aware",
            ])
            .assert()
            .success();

        Command::cargo_bin("crosshash")
            .unwrap()
            .args(["--db", db.to_str().unwrap(), "repo", "info", "ws"])
            .assert()
            .success()
            .stdout(contains("CargoWorkspace"));
    }

    #[test]
    fn detects_plain_cargo_without_workspace_aware() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("cargo-proj");
        fs::create_dir_all(repo.join("src")).unwrap();
        fs::write(
            repo.join("Cargo.toml"),
            "[package]\nname = \"test\"\nversion = \"0.1.0\"\n",
        )
        .unwrap();
        fs::write(repo.join("src/lib.rs"), "pub fn plain_fn() -> u32 { 1 }\n").unwrap();
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
                "cargo-proj",
            ])
            .assert()
            .success();

        Command::cargo_bin("crosshash")
            .unwrap()
            .args(["--db", db.to_str().unwrap(), "repo", "info", "cargo-proj"])
            .assert()
            .success()
            .stdout(contains("Cargo"));
    }

    #[test]
    fn detects_npm_workspace_when_workspace_aware() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("npm-ws");
        fs::create_dir_all(repo.join("src")).unwrap();
        fs::write(
            repo.join("package.json"),
            "{\"name\": \"ws\", \"workspaces\": [\"packages/*\"]}",
        )
        .unwrap();
        fs::write(repo.join("src/lib.rs"), "pub fn npm_fn() -> u32 { 1 }\n").unwrap();
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
                "npm-ws",
                "--workspace-aware",
            ])
            .assert()
            .success();

        Command::cargo_bin("crosshash")
            .unwrap()
            .args(["--db", db.to_str().unwrap(), "repo", "info", "npm-ws"])
            .assert()
            .success()
            .stdout(contains("NpmWorkspace"));
    }

    #[test]
    fn detects_nx_monorepo() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("nx-repo");
        fs::create_dir_all(repo.join("src")).unwrap();
        fs::write(repo.join("nx.json"), "{\"tasksRunnerOptions\": {}}").unwrap();
        fs::write(repo.join("src/lib.rs"), "pub fn nx_fn() -> u32 { 1 }\n").unwrap();
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
                "nx-repo",
            ])
            .assert()
            .success();

        Command::cargo_bin("crosshash")
            .unwrap()
            .args(["--db", db.to_str().unwrap(), "repo", "info", "nx-repo"])
            .assert()
            .success()
            .stdout(contains("Nx"));
    }

    #[test]
    fn detects_turborepo() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("turbo-repo");
        fs::create_dir_all(repo.join("src")).unwrap();
        fs::write(repo.join("turbo.json"), "{\"pipeline\": {}}").unwrap();
        fs::write(repo.join("src/lib.rs"), "pub fn turbo_fn() -> u32 { 1 }\n").unwrap();
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
                "turbo-repo",
            ])
            .assert()
            .success();

        Command::cargo_bin("crosshash")
            .unwrap()
            .args(["--db", db.to_str().unwrap(), "repo", "info", "turbo-repo"])
            .assert()
            .success()
            .stdout(contains("Turborepo"));
    }

    #[test]
    fn detects_go_modules() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("go-proj");
        fs::create_dir_all(repo.join("src")).unwrap();
        fs::write(
            repo.join("go.mod"),
            "module example.com/test\n\ngo 1.21\n",
        )
        .unwrap();
        fs::write(repo.join("src/lib.rs"), "pub fn go_fn() -> u32 { 1 }\n").unwrap();
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
                "go-proj",
            ])
            .assert()
            .success();

        Command::cargo_bin("crosshash")
            .unwrap()
            .args(["--db", db.to_str().unwrap(), "repo", "info", "go-proj"])
            .assert()
            .success()
            .stdout(contains("GoModules"));
    }
}

mod subphase_33_entity_lookup_across_repos {
    use super::*;

    #[test]
    fn entity_lookup_all_searches_across_repos() {
        let dir = tempfile::tempdir().unwrap();
        let (core, _mid, _app) = setup_three_repos(dir.path());
        let db = dir.path().join("test.db");

        add_repo(db.to_str().unwrap(), "aaa-core", &core);
        add_repo(db.to_str().unwrap(), "bbb-mid", &_mid);
        add_repo(db.to_str().unwrap(), "ccc-app", &_app);
        index_all(db.to_str().unwrap());

        Command::cargo_bin("crosshash")
            .unwrap()
            .args([
                "--db",
                db.to_str().unwrap(),
                "entity",
                "lookup",
                "core_util",
                "--all",
            ])
            .assert()
            .success()
            .stdout(contains("core_util"));
    }

    #[test]
    fn entity_lookup_without_all_scopes_to_single_repo() {
        let dir = tempfile::tempdir().unwrap();
        let (core, _mid, _app) = setup_three_repos(dir.path());
        let db = dir.path().join("test.db");

        add_repo(db.to_str().unwrap(), "aaa-core", &core);
        add_repo(db.to_str().unwrap(), "bbb-mid", &_mid);
        add_repo(db.to_str().unwrap(), "ccc-app", &_app);
        index_all(db.to_str().unwrap());

        Command::cargo_bin("crosshash")
            .unwrap()
            .args([
                "--db",
                db.to_str().unwrap(),
                "entity",
                "lookup",
                "core_util",
                "--repo",
                "aaa-core",
            ])
            .assert()
            .success()
            .stdout(contains("core_util"));
    }
}

mod subphase_35_public_api_surface {
    use super::*;

    #[test]
    fn repo_info_shows_exported_entities() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("api-lib");
        fs::create_dir_all(repo.join("src")).unwrap();
        fs::write(
            repo.join("src/lib.rs"),
            "pub fn public_one() -> u32 { 1 }\npub fn public_two() -> u32 { 2 }\nfn private_fn() -> u32 { 3 }\n",
        )
        .unwrap();
        let db = dir.path().join("test.db");

        add_repo(db.to_str().unwrap(), "api-lib", repo.to_str().unwrap());
        index_repo(db.to_str().unwrap(), "api-lib");

        Command::cargo_bin("crosshash")
            .unwrap()
            .args(["--db", db.to_str().unwrap(), "repo", "info", "api-lib"])
            .assert()
            .success()
            .stdout(contains("exports: 2"));
    }

    #[test]
    fn only_exported_public_entities_appear_in_api_surface() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("mixed-vis");
        fs::create_dir_all(repo.join("src")).unwrap();
        fs::write(
            repo.join("src/lib.rs"),
            "pub fn exported() -> u32 { internal() }\nfn internal() -> u32 { 1 }\n",
        )
        .unwrap();
        let db = dir.path().join("test.db");

        add_repo(db.to_str().unwrap(), "mixed-vis", repo.to_str().unwrap());
        index_repo(db.to_str().unwrap(), "mixed-vis");

        Command::cargo_bin("crosshash")
            .unwrap()
            .args(["--db", db.to_str().unwrap(), "repo", "info", "mixed-vis"])
            .assert()
            .success()
            .stdout(contains("entities: 2"))
            .stdout(contains("exports: 1"));
    }
}

mod subphase_36_edge_staleness {
    use super::*;

    #[test]
    fn validate_edges_reports_valid_after_fresh_index() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("svc");
        fs::create_dir_all(repo.join("src")).unwrap();
        fs::write(
            repo.join("src/lib.rs"),
            "pub fn caller() -> u32 { callee() }\npub fn callee() -> u32 { 1 }\n",
        )
        .unwrap();
        let db = dir.path().join("test.db");

        add_repo(db.to_str().unwrap(), "svc", repo.to_str().unwrap());
        index_repo(db.to_str().unwrap(), "svc");

        Command::cargo_bin("crosshash")
            .unwrap()
            .args([
                "--db",
                db.to_str().unwrap(),
                "graph",
                "validate-edges",
                "--repo",
                "svc",
            ])
            .assert()
            .success()
            .stdout(contains("stale edges: 0"));
    }

    #[test]
    fn validate_edges_shows_valid_count_for_fresh_index() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("svc");
        fs::create_dir_all(repo.join("src")).unwrap();
        fs::write(
            repo.join("src/lib.rs"),
            "pub fn caller() -> u32 { callee() }\npub fn callee() -> u32 { 1 }\n",
        )
        .unwrap();
        let db = dir.path().join("test.db");

        add_repo(db.to_str().unwrap(), "svc", repo.to_str().unwrap());
        index_repo(db.to_str().unwrap(), "svc");

        Command::cargo_bin("crosshash")
            .unwrap()
            .args([
                "--db",
                db.to_str().unwrap(),
                "graph",
                "validate-edges",
                "--repo",
                "svc",
            ])
            .assert()
            .success()
            .stdout(contains("valid edges:"))
            .stdout(contains("stale edges: 0"));
    }

    #[test]
    fn validate_edges_across_two_repos() {
        let dir = tempfile::tempdir().unwrap();
        let api = dir.path().join("aaa-api");
        let app = dir.path().join("bbb-app");
        fs::create_dir_all(api.join("src")).unwrap();
        fs::create_dir_all(app.join("src")).unwrap();
        fs::write(api.join("src/lib.rs"), "pub fn shared_api() -> u32 { 1 }\n").unwrap();
        fs::write(
            app.join("src/lib.rs"),
            "pub fn use_api() -> u32 { shared_api() }\n",
        )
        .unwrap();
        let db = dir.path().join("test.db");

        add_repo(db.to_str().unwrap(), "aaa-api", api.to_str().unwrap());
        add_repo(db.to_str().unwrap(), "bbb-app", app.to_str().unwrap());
        index_repo(db.to_str().unwrap(), "aaa-api");
        index_repo(db.to_str().unwrap(), "bbb-app");

        Command::cargo_bin("crosshash")
            .unwrap()
            .args([
                "--db",
                db.to_str().unwrap(),
                "graph",
                "validate-edges",
                "--repo",
                "bbb-app",
            ])
            .assert()
            .success()
            .stdout(contains("stale edges: 0"));
    }
}

mod subphase_37_cross_repo_graph_queries {
    use super::*;

    #[test]
    fn callers_cross_repo_traverses_repo_boundary() {
        let dir = tempfile::tempdir().unwrap();
        let (core, _mid, app) = setup_three_repos(dir.path());
        let db = dir.path().join("test.db");

        add_repo(db.to_str().unwrap(), "aaa-core", &core);
        add_repo(db.to_str().unwrap(), "bbb-mid", &_mid);
        add_repo(db.to_str().unwrap(), "ccc-app", &app);
        index_repo(db.to_str().unwrap(), "aaa-core");
        index_repo(db.to_str().unwrap(), "bbb-mid");
        index_repo(db.to_str().unwrap(), "ccc-app");

        Command::cargo_bin("crosshash")
            .unwrap()
            .args([
                "--db",
                db.to_str().unwrap(),
                "graph",
                "callers",
                "core_util",
                "--repo",
                "aaa-core",
                "--cross-repo",
            ])
            .assert()
            .success()
            .stdout(contains("mid_fn"))
            .stdout(contains("app_main"));
    }

    #[test]
    fn callees_cross_repo_traverses_repo_boundary() {
        let dir = tempfile::tempdir().unwrap();
        let (core, _mid, app) = setup_three_repos(dir.path());
        let db = dir.path().join("test.db");

        add_repo(db.to_str().unwrap(), "aaa-core", &core);
        add_repo(db.to_str().unwrap(), "bbb-mid", &_mid);
        add_repo(db.to_str().unwrap(), "ccc-app", &app);
        index_repo(db.to_str().unwrap(), "aaa-core");
        index_repo(db.to_str().unwrap(), "bbb-mid");
        index_repo(db.to_str().unwrap(), "ccc-app");

        Command::cargo_bin("crosshash")
            .unwrap()
            .args([
                "--db",
                db.to_str().unwrap(),
                "graph",
                "callees",
                "app_main",
                "--repo",
                "ccc-app",
                "--cross-repo",
            ])
            .assert()
            .success()
            .stdout(contains("core_util"))
            .stdout(contains("mid_fn"));
    }

    #[test]
    fn blast_radius_cross_repo_traverses_all_callers() {
        let dir = tempfile::tempdir().unwrap();
        let (core, _mid, app) = setup_three_repos(dir.path());
        let db = dir.path().join("test.db");

        add_repo(db.to_str().unwrap(), "aaa-core", &core);
        add_repo(db.to_str().unwrap(), "bbb-mid", &_mid);
        add_repo(db.to_str().unwrap(), "ccc-app", &app);
        index_repo(db.to_str().unwrap(), "aaa-core");
        index_repo(db.to_str().unwrap(), "bbb-mid");
        index_repo(db.to_str().unwrap(), "ccc-app");

        Command::cargo_bin("crosshash")
            .unwrap()
            .args([
                "--db",
                db.to_str().unwrap(),
                "graph",
                "blast-radius",
                "core_util",
                "--repo",
                "aaa-core",
                "--cross-repo",
            ])
            .assert()
            .success()
            .stdout(contains("mid_fn"))
            .stdout(contains("app_main"));
    }

    #[test]
    fn callers_without_cross_repo_stays_within_repo() {
        let dir = tempfile::tempdir().unwrap();
        let (core, _mid, _app) = setup_three_repos(dir.path());
        let db = dir.path().join("test.db");

        add_repo(db.to_str().unwrap(), "aaa-core", &core);
        add_repo(db.to_str().unwrap(), "bbb-mid", &_mid);
        add_repo(db.to_str().unwrap(), "ccc-app", &_app);
        index_repo(db.to_str().unwrap(), "aaa-core");
        index_repo(db.to_str().unwrap(), "bbb-mid");
        index_repo(db.to_str().unwrap(), "ccc-app");

        Command::cargo_bin("crosshash")
            .unwrap()
            .args([
                "--db",
                db.to_str().unwrap(),
                "graph",
                "callers",
                "core_util",
                "--repo",
                "aaa-core",
            ])
            .assert()
            .success()
            .stdout(contains("core_helper"));
    }
}

mod subphase_38_indexing_pipeline {
    use super::*;

    #[test]
    fn index_with_no_args_indexes_all_registered_repos() {
        let dir = tempfile::tempdir().unwrap();
        let (core, mid, app) = setup_three_repos(dir.path());
        let db = dir.path().join("test.db");

        add_repo(db.to_str().unwrap(), "aaa-core", &core);
        add_repo(db.to_str().unwrap(), "bbb-mid", &mid);
        add_repo(db.to_str().unwrap(), "ccc-app", &app);

        Command::cargo_bin("crosshash")
            .unwrap()
            .args(["--db", db.to_str().unwrap(), "index", "--no-ai"])
            .assert()
            .success()
            .stdout(contains("indexed 3 repos"));
    }

    #[test]
    fn index_with_repo_flag_indexes_only_that_repo() {
        let dir = tempfile::tempdir().unwrap();
        let (core, _mid, _app) = setup_three_repos(dir.path());
        let db = dir.path().join("test.db");

        add_repo(db.to_str().unwrap(), "aaa-core", &core);
        add_repo(db.to_str().unwrap(), "bbb-mid", &_mid);
        add_repo(db.to_str().unwrap(), "ccc-app", &_app);

        Command::cargo_bin("crosshash")
            .unwrap()
            .args(["--db", db.to_str().unwrap(), "index", "--repo", "aaa-core", "--no-ai"])
            .assert()
            .success()
            .stdout(contains("entities extracted"));

        Command::cargo_bin("crosshash")
            .unwrap()
            .args(["--db", db.to_str().unwrap(), "repo", "info", "aaa-core"])
            .assert()
            .success()
            .stdout(contains("entities: 2"));

        Command::cargo_bin("crosshash")
            .unwrap()
            .args(["--db", db.to_str().unwrap(), "repo", "info", "bbb-mid"])
            .assert()
            .success()
            .stdout(contains("entities: 0"));
    }

    #[test]
    fn incremental_index_skips_unchanged_files() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("svc");
        fs::create_dir_all(repo.join("src")).unwrap();
        fs::write(
            repo.join("src/lib.rs"),
            "pub fn inc_fn() -> u32 { 1 }\n",
        )
        .unwrap();
        let db = dir.path().join("test.db");

        add_repo(db.to_str().unwrap(), "svc", repo.to_str().unwrap());
        index_repo(db.to_str().unwrap(), "svc");

        Command::cargo_bin("crosshash")
            .unwrap()
            .args([
                "--db",
                db.to_str().unwrap(),
                "index",
                "--repo",
                "svc",
                "--incremental",
                "--no-ai",
            ])
            .assert()
            .success()
            .stdout(contains("files skipped"));
    }

    #[test]
    fn three_repo_cross_repo_index_and_query() {
        let dir = tempfile::tempdir().unwrap();
        let (core, mid, app) = setup_three_repos(dir.path());
        let db = dir.path().join("test.db");

        add_repo(db.to_str().unwrap(), "aaa-core", &core);
        add_repo(db.to_str().unwrap(), "bbb-mid", &mid);
        add_repo(db.to_str().unwrap(), "ccc-app", &app);

        index_repo(db.to_str().unwrap(), "aaa-core");
        index_repo(db.to_str().unwrap(), "bbb-mid");
        index_repo(db.to_str().unwrap(), "ccc-app");

        Command::cargo_bin("crosshash")
            .unwrap()
            .args(["--db", db.to_str().unwrap(), "repo", "info", "aaa-core"])
            .assert()
            .success()
            .stdout(contains("exports: 2"));

        Command::cargo_bin("crosshash")
            .unwrap()
            .args(["--db", db.to_str().unwrap(), "repo", "info", "bbb-mid"])
            .assert()
            .success()
            .stdout(contains("exports: 2"));

        Command::cargo_bin("crosshash")
            .unwrap()
            .args(["--db", db.to_str().unwrap(), "repo", "info", "ccc-app"])
            .assert()
            .success()
            .stdout(contains("exports: 1"));
    }
}
