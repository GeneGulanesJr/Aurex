use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use crosshash_ai::AiStats;
use crosshash_core::{Edge, EdgeKind, EdgeSource, Language, Repo, WorkspaceType};
use crosshash_graph::GraphStorage;
use crosshash_impact::{
    ChangeKind, ChangedEntity, ImpactAnalyzer, ImpactClassifier, ImpactReportBuilder,
};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct ApiConfig {
    pub api_key: Option<String>,
    pub max_requests_per_minute: u32,
}

pub struct ApiState {
    pub config: ApiConfig,
    pub storage: Arc<Mutex<GraphStorage>>,
}

pub fn api_router(config: ApiConfig) -> Router {
    let path = PathBuf::from(".crosshash/crosshash.db");
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let storage = GraphStorage::open(&path).expect("failed to open database");
    api_router_with_storage(config, storage)
}

pub fn api_router_with_storage(config: ApiConfig, storage: GraphStorage) -> Router {
    let state = Arc::new(ApiState {
        config,
        storage: Arc::new(Mutex::new(storage)),
    });
    Router::new()
        .route("/v1/repos", get(list_repos).post(register_repo))
        .route("/v1/impact", post(run_impact))
        .route("/v1/discover-edges", post(discover_edges))
        .route("/v1/feedback", post(feedback))
        .route("/v1/ai-stats", get(ai_stats))
        .with_state(state)
}

fn authorized(headers: &HeaderMap, config: &ApiConfig) -> bool {
    match &config.api_key {
        Some(key) => headers.get("x-api-key").and_then(|v| v.to_str().ok()) == Some(key.as_str()),
        None => true,
    }
}

fn lock_storage(
    state: &ApiState,
) -> Result<std::sync::MutexGuard<'_, GraphStorage>, (StatusCode, Json<serde_json::Value>)> {
    state.storage.lock().map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"status": "error", "message": "storage unavailable"})),
        )
    })
}

fn err_json(e: crosshash_core::CoreError) -> (StatusCode, Json<serde_json::Value>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(serde_json::json!({"status": "error", "message": e.to_string()})),
    )
}

async fn list_repos(headers: HeaderMap, State(state): State<Arc<ApiState>>) -> impl IntoResponse {
    if !authorized(&headers, &state.config) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let storage = match lock_storage(&state) {
        Ok(s) => s,
        Err(e) => return e.into_response(),
    };
    match storage.list_repos() {
        Ok(repos) => Json(serde_json::json!({"repos": repos})).into_response(),
        Err(e) => err_json(e).into_response(),
    }
}

#[derive(Debug, Deserialize)]
struct RegisterRepoRequest {
    path: String,
    name: String,
    #[serde(default)]
    workspace_aware: bool,
}

async fn register_repo(
    headers: HeaderMap,
    State(state): State<Arc<ApiState>>,
    Json(body): Json<RegisterRepoRequest>,
) -> impl IntoResponse {
    if !authorized(&headers, &state.config) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let root =
        match PathBuf::from(&body.path).canonicalize() {
            Ok(p) => p,
            Err(e) => return (
                StatusCode::BAD_REQUEST,
                Json(
                    serde_json::json!({"status": "error", "message": format!("invalid path: {e}")}),
                ),
            )
                .into_response(),
        };
    let ws_type = detect_workspace_type(&root, body.workspace_aware);
    let commit_hash = crosshash_git::get_head_commit(&root).unwrap_or_else(|_| "WORKTREE".into());
    let repo = Repo {
        id: Uuid::now_v7(),
        name: body.name.clone(),
        root_path: root.to_string_lossy().to_string(),
        git_remote: None,
        default_branch: "main".into(),
        languages: vec![],
        workspace_type: ws_type,
        last_indexed_at: chrono::Utc::now(),
        commit_hash,
    };
    let storage = match lock_storage(&state) {
        Ok(s) => s,
        Err(e) => return e.into_response(),
    };
    match storage.insert_repo(&repo) {
        Ok(()) => Json(serde_json::json!({"status": "ok", "repo": repo})).into_response(),
        Err(e) => err_json(e).into_response(),
    }
}

#[derive(Debug, Deserialize)]
struct ImpactRequest {
    entity: Option<String>,
    source: Option<String>,
    #[serde(default)]
    target: Vec<String>,
    #[serde(default)]
    all: bool,
}

async fn run_impact(
    headers: HeaderMap,
    State(state): State<Arc<ApiState>>,
    Json(body): Json<ImpactRequest>,
) -> impl IntoResponse {
    if !authorized(&headers, &state.config) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let storage = match lock_storage(&state) {
        Ok(s) => s,
        Err(e) => return e.into_response(),
    };
    let entities = match storage.get_entities_all() {
        Ok(e) => e,
        Err(e) => return err_json(e).into_response(),
    };
    let edges = match storage.get_edges_all() {
        Ok(e) => e,
        Err(e) => return err_json(e).into_response(),
    };
    let changed: Vec<uuid::Uuid> = if let Some(entity_name) = &body.entity {
        match storage.get_entities_by_name(entity_name, None) {
            Ok(found) => found.iter().map(|e| e.id).collect(),
            Err(e) => return err_json(e).into_response(),
        }
    } else {
        entities.iter().take(1).map(|e| e.id).collect()
    };
    let affected = ImpactAnalyzer::default().analyze(&changed, &entities, &edges);
    let changed_entities = changed
        .iter()
        .map(|id| ChangedEntity {
            entity_id: *id,
            old_name: None,
            new_name: None,
            change_kind: ChangeKind::Modified,
            diff_summary: "current indexed state".into(),
        })
        .collect::<Vec<_>>();
    let classifications = affected
        .iter()
        .map(|a| ImpactClassifier::classify(ChangeKind::Modified, a))
        .collect::<Vec<_>>();
    let repos = match storage.list_repos() {
        Ok(r) => r,
        Err(e) => return err_json(e).into_response(),
    };
    let report = ImpactReportBuilder {
        changed_repos: repos
            .iter()
            .filter(|r| body.source.as_deref().is_none_or(|name| r.name == name))
            .map(|r| r.id)
            .collect(),
        affected_repos: repos
            .iter()
            .filter(|r| body.all || body.target.is_empty() || body.target.contains(&r.name))
            .map(|r| r.id)
            .collect(),
        changed_entities,
        affected_entities: affected,
        classifications,
        generated_at: chrono::Utc::now(),
    };
    Json(serde_json::json!({"status": "ok", "report": report, "ai_calls": 0})).into_response()
}

#[derive(Debug, Deserialize)]
struct DiscoverEdgesRequest {
    repo: Option<String>,
    #[serde(default)]
    no_ai: bool,
    #[serde(default)]
    force_ai: bool,
    #[serde(default)]
    static_only: bool,
}

async fn discover_edges(
    headers: HeaderMap,
    State(state): State<Arc<ApiState>>,
    Json(body): Json<DiscoverEdgesRequest>,
) -> impl IntoResponse {
    if !authorized(&headers, &state.config) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let storage = match lock_storage(&state) {
        Ok(s) => s,
        Err(e) => return e.into_response(),
    };
    let repos = match storage.list_repos() {
        Ok(r) => r,
        Err(e) => return err_json(e).into_response(),
    };
    let mut surfaces = Vec::new();
    let mut static_edge_count = 0usize;
    for repo in &repos {
        if body.repo.as_deref().is_none_or(|name| repo.name == name) {
            let exports = storage.get_public_api_surface(repo.id).unwrap_or_default();
            let repo_edges = storage.get_edges_by_repo(repo.id).unwrap_or_default();
            static_edge_count += repo_edges.len();
            surfaces.push(serde_json::json!({
                "repo": repo.name,
                "exports": exports.len(),
                "entities": exports.iter().map(|e| serde_json::json!({
                    "name": e.name,
                    "kind": format!("{:?}", e.kind),
                    "visibility": format!("{:?}", e.visibility),
                })).collect::<Vec<_>>(),
            }));
        }
    }
    Json(serde_json::json!({
        "status": "ok",
        "static_edges": static_edge_count,
        "ai_edges_suggested": 0,
        "ai_cost": 0.0,
        "surfaces": surfaces,
    }))
    .into_response()
}

#[derive(Debug, Deserialize)]
struct FeedbackRequest {
    edge_id: String,
    decision: String,
}

async fn feedback(
    headers: HeaderMap,
    State(state): State<Arc<ApiState>>,
    Json(body): Json<FeedbackRequest>,
) -> impl IntoResponse {
    if !authorized(&headers, &state.config) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let id = match Uuid::parse_str(&body.edge_id) {
        Ok(id) => id,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"status": "error", "message": "invalid UUID"})),
            )
                .into_response()
        }
    };
    let storage = match lock_storage(&state) {
        Ok(s) => s,
        Err(e) => return e.into_response(),
    };
    let suggestion = match storage.get_suggestion_by_id(&id) {
        Ok(Some(s)) => s,
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"status": "error", "message": "suggestion not found"})),
            )
                .into_response()
        }
        Err(e) => return err_json(e).into_response(),
    };
    let status = match body.decision.as_str() {
        "accept" => "accepted",
        "reject" => "rejected",
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"status": "error", "message": "decision must be 'accept' or 'reject'"})),
            )
                .into_response()
        }
    };
    if let Err(e) = storage.update_suggestion_status(&id, status) {
        return err_json(e).into_response();
    }
    let fb_id = Uuid::now_v7();
    if let Err(e) = storage.insert_feedback(&fb_id, &id, &body.decision, None) {
        return err_json(e).into_response();
    }
    if body.decision == "accept" {
        if let (Some(exporter), Some(consumer)) = (
            suggestion["exporter_entity_id"]
                .as_str()
                .and_then(|s| Uuid::parse_str(s).ok()),
            suggestion["consumer_entity_id"]
                .as_str()
                .and_then(|s| Uuid::parse_str(s).ok()),
        ) {
            let edge = Edge {
                id: Uuid::now_v7(),
                source_entity_id: consumer,
                target_entity_id: exporter,
                kind: EdgeKind::PackageDep,
                confidence: suggestion["confidence"].as_f64().unwrap_or(0.5),
                source: EdgeSource::AiInferred,
                metadata: Some(serde_json::json!({
                    "edge_type": suggestion["edge_type"],
                    "reasoning": suggestion["reasoning"],
                })),
                created_at: chrono::Utc::now(),
                validated_at: Some(chrono::Utc::now()),
            };
            let _ = storage.insert_edge(&edge);
        }
    }
    Json(serde_json::json!({"status": "recorded"})).into_response()
}

async fn ai_stats(headers: HeaderMap, State(state): State<Arc<ApiState>>) -> impl IntoResponse {
    if !authorized(&headers, &state.config) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let storage = match lock_storage(&state) {
        Ok(s) => s,
        Err(e) => return e.into_response(),
    };
    match storage.get_ai_inference_logs(1000) {
        Ok(logs) => {
            let invocations = logs.len();
            let total_input_tokens: u64 =
                logs.iter().filter_map(|l| l["input_tokens"].as_u64()).sum();
            let total_output_tokens: u64 = logs
                .iter()
                .filter_map(|l| l["output_tokens"].as_u64())
                .sum();
            let total_cost: f64 = logs
                .iter()
                .filter_map(|l| l["estimated_cost_usd"].as_f64())
                .sum();
            let edges_suggested: usize = logs
                .iter()
                .filter_map(|l| l["edges_suggested"].as_u64())
                .sum::<u64>() as usize;
            let edges_auto_accepted: usize = logs
                .iter()
                .filter_map(|l| l["edges_auto_accepted"].as_u64())
                .sum::<u64>() as usize;
            Json(AiStats {
                invocations,
                total_input_tokens,
                total_output_tokens,
                total_cost_usd: total_cost,
                edges_suggested,
                edges_auto_accepted,
            })
            .into_response()
        }
        Err(e) => err_json(e).into_response(),
    }
}

fn detect_workspace_type(root: &std::path::Path, workspace_aware: bool) -> WorkspaceType {
    if root.join("nx.json").exists() {
        WorkspaceType::Nx
    } else if root.join("turbo.json").exists() {
        WorkspaceType::Turborepo
    } else if root.join("Cargo.toml").exists() {
        if workspace_aware
            && std::fs::read_to_string(root.join("Cargo.toml"))
                .unwrap_or_default()
                .contains("[workspace]")
        {
            WorkspaceType::CargoWorkspace
        } else {
            WorkspaceType::Cargo
        }
    } else if root.join("package.json").exists() {
        if workspace_aware
            && std::fs::read_to_string(root.join("package.json"))
                .unwrap_or_default()
                .contains("\"workspaces\"")
        {
            WorkspaceType::NpmWorkspace
        } else {
            WorkspaceType::Npm
        }
    } else if root.join("go.mod").exists() {
        WorkspaceType::GoModules
    } else {
        WorkspaceType::None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use tower::ServiceExt;

    fn no_auth_config() -> ApiConfig {
        ApiConfig {
            api_key: None,
            max_requests_per_minute: 60,
        }
    }

    fn auth_config() -> ApiConfig {
        ApiConfig {
            api_key: Some("secret-key".into()),
            max_requests_per_minute: 60,
        }
    }

    fn test_app(config: ApiConfig) -> Router {
        let storage = GraphStorage::open_in_memory().unwrap();
        api_router_with_storage(config, storage)
    }

    async fn send_get(
        app: Router,
        path: &str,
        api_key: Option<&str>,
    ) -> (StatusCode, serde_json::Value) {
        let mut req = Request::builder().uri(path).body(Body::empty()).unwrap();
        if let Some(key) = api_key {
            req.headers_mut().insert("x-api-key", key.parse().unwrap());
        }
        let resp = app.oneshot(req).await.unwrap();
        let status = resp.status();
        let bytes = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
            .await
            .unwrap();
        let body: serde_json::Value =
            serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
        (status, body)
    }

    async fn send_post(
        app: Router,
        path: &str,
        body: Option<&str>,
        api_key: Option<&str>,
    ) -> (StatusCode, serde_json::Value) {
        let body_bytes = body.map(|b| b.as_bytes().to_vec()).unwrap_or_default();
        let mut req = Request::builder()
            .method("POST")
            .uri(path)
            .body(Body::from(body_bytes))
            .unwrap();
        if let Some(key) = api_key {
            req.headers_mut().insert("x-api-key", key.parse().unwrap());
        }
        if body.is_some() {
            req.headers_mut()
                .insert("content-type", "application/json".parse().unwrap());
        }
        let resp = app.oneshot(req).await.unwrap();
        let status = resp.status();
        let bytes = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
            .await
            .unwrap();
        let body: serde_json::Value =
            serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
        (status, body)
    }

    #[test]
    fn router_builds_with_all_core_routes() {
        let _ = test_app(no_auth_config());
    }

    #[tokio::test]
    async fn list_repos_no_auth_returns_empty_list() {
        let app = test_app(no_auth_config());
        let (status, body) = send_get(app, "/v1/repos", None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["repos"], serde_json::json!([]));
    }

    #[tokio::test]
    async fn register_repo_no_auth_returns_error_for_invalid_path() {
        let app = test_app(no_auth_config());
        let (status, body) = send_post(
            app,
            "/v1/repos",
            Some(r#"{"path":"/nonexistent","name":"test"}"#),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["status"], "error");
    }

    #[tokio::test]
    async fn run_impact_no_auth_returns_ok() {
        let app = test_app(no_auth_config());
        let (status, body) = send_post(app, "/v1/impact", Some("{}"), None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["status"], "ok");
    }

    #[tokio::test]
    async fn discover_edges_no_auth_returns_ok() {
        let app = test_app(no_auth_config());
        let (status, body) = send_post(app, "/v1/discover-edges", Some("{}"), None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["status"], "ok");
    }

    #[tokio::test]
    async fn feedback_no_auth_returns_error_for_missing_suggestion() {
        let app = test_app(no_auth_config());
        let id = uuid::Uuid::now_v7();
        let (status, body) = send_post(
            app,
            "/v1/feedback",
            Some(&format!(r#"{{"edge_id":"{}","decision":"accept"}}"#, id)),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn feedback_rejects_invalid_uuid() {
        let app = test_app(no_auth_config());
        let (status, body) = send_post(
            app,
            "/v1/feedback",
            Some(r#"{"edge_id":"not-a-uuid","decision":"accept"}"#),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn feedback_rejects_invalid_decision() {
        let storage = GraphStorage::open_in_memory().unwrap();
        let sug_id = uuid::Uuid::now_v7();
        let exporter = uuid::Uuid::now_v7();
        let consumer = uuid::Uuid::now_v7();
        storage
            .insert_ai_edge_suggestion(
                &sug_id,
                &exporter,
                &consumer,
                "APIContract",
                "test",
                0.9,
                "pending",
            )
            .unwrap();
        let app = api_router_with_storage(no_auth_config(), storage);
        let (status, _body) = send_post(
            app,
            "/v1/feedback",
            Some(&format!(r#"{{"edge_id":"{}","decision":"maybe"}}"#, sug_id)),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn ai_stats_no_auth_returns_defaults() {
        let app = test_app(no_auth_config());
        let (status, body) = send_get(app, "/v1/ai-stats", None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["invocations"], 0);
        assert_eq!(body["total_cost_usd"], 0.0);
    }

    #[tokio::test]
    async fn unauthorized_without_api_key_when_auth_enabled() {
        let app = test_app(auth_config());
        let (status, _) = send_get(app, "/v1/repos", None).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn authorized_with_correct_api_key() {
        let app = test_app(auth_config());
        let (status, body) = send_get(app, "/v1/repos", Some("secret-key")).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["repos"], serde_json::json!([]));
    }

    #[tokio::test]
    async fn unauthorized_with_wrong_api_key() {
        let app = test_app(auth_config());
        let (status, _) = send_get(app, "/v1/repos", Some("wrong-key")).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn post_endpoints_require_auth_when_enabled() {
        for (path, body) in [
            ("/v1/repos", Some(r#"{"path":"/tmp","name":"x"}"#)),
            ("/v1/impact", Some("{}")),
            ("/v1/discover-edges", Some("{}")),
            (
                "/v1/feedback",
                Some(&format!(
                    r#"{{"edge_id":"{}","decision":"accept"}}"#,
                    uuid::Uuid::now_v7()
                )),
            ),
        ] {
            let app = test_app(auth_config());
            let (status, _) = send_post(app, path, body, None).await;
            assert_eq!(
                status,
                StatusCode::UNAUTHORIZED,
                "POST {} should require auth",
                path
            );
        }
    }

    #[test]
    fn api_config_debug() {
        let config = ApiConfig {
            api_key: Some("test".into()),
            max_requests_per_minute: 100,
        };
        assert!(format!("{:?}", config).contains("ApiConfig"));
    }

    #[tokio::test]
    async fn list_repos_with_data() {
        let storage = GraphStorage::open_in_memory().unwrap();
        let repo = Repo {
            id: uuid::Uuid::now_v7(),
            name: "test-repo".into(),
            root_path: "/tmp/test".into(),
            git_remote: None,
            default_branch: "main".into(),
            languages: vec![Language::Rust],
            workspace_type: WorkspaceType::None,
            last_indexed_at: chrono::Utc::now(),
            commit_hash: "abc".into(),
        };
        storage.insert_repo(&repo).unwrap();
        let app = api_router_with_storage(no_auth_config(), storage);
        let (status, body) = send_get(app, "/v1/repos", None).await;
        assert_eq!(status, StatusCode::OK);
        let repos = body["repos"].as_array().unwrap();
        assert_eq!(repos.len(), 1);
        assert_eq!(repos[0]["name"], "test-repo");
    }

    #[tokio::test]
    async fn feedback_accept_flow() {
        let storage = GraphStorage::open_in_memory().unwrap();
        let repo_id = uuid::Uuid::now_v7();
        let entity_a = uuid::Uuid::now_v7();
        let entity_b = uuid::Uuid::now_v7();
        storage
            .insert_ai_edge_suggestion(
                &uuid::Uuid::now_v7(),
                &entity_a,
                &entity_b,
                "APIContract",
                "test reasoning",
                0.9,
                "pending",
            )
            .unwrap();
        let pending = storage.get_pending_suggestions().unwrap();
        let sug_id = pending[0]["id"].as_str().unwrap();

        let app = api_router_with_storage(no_auth_config(), storage);
        let (status, body) = send_post(
            app,
            "/v1/feedback",
            Some(&format!(
                r#"{{"edge_id":"{}","decision":"accept"}}"#,
                sug_id
            )),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["status"], "recorded");
    }

    #[tokio::test]
    async fn ai_stats_with_logs() {
        let storage = GraphStorage::open_in_memory().unwrap();
        storage
            .insert_ai_inference_log(
                &uuid::Uuid::now_v7(),
                "NewExports",
                "all",
                None,
                None,
                100,
                50,
                0.003,
                3,
                2,
            )
            .unwrap();
        let app = api_router_with_storage(no_auth_config(), storage);
        let (status, body) = send_get(app, "/v1/ai-stats", None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["invocations"], 1);
        assert_eq!(body["edges_suggested"], 3);
    }
}
