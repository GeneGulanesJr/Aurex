use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use crosshash_ai::AiStats;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Debug, Clone)]
pub struct ApiConfig {
    pub api_key: Option<String>,
    pub max_requests_per_minute: u32,
}
#[derive(Debug, Clone)]
pub struct ApiState {
    pub config: ApiConfig,
}

pub fn api_router(config: ApiConfig) -> Router {
    let state = Arc::new(ApiState { config });
    Router::new()
        .route("/v1/repos", get(list_repos).post(register_repo))
        .route("/v1/impact", post(run_impact))
        .route("/v1/discover-edges", post(discover_edges))
        .route("/v1/feedback", post(feedback))
        .route("/v1/ai-stats", get(ai_stats))
        .with_state(state)
}

#[derive(Debug, Serialize, Deserialize)]
struct Status {
    status: &'static str,
}

fn authorized(headers: &HeaderMap, state: &ApiState) -> bool {
    match &state.config.api_key {
        Some(key) => headers.get("x-api-key").and_then(|v| v.to_str().ok()) == Some(key.as_str()),
        None => true,
    }
}

async fn guard(
    headers: HeaderMap,
    State(state): State<Arc<ApiState>>,
) -> Result<(), impl IntoResponse> {
    if authorized(&headers, &state) {
        Ok(())
    } else {
        Err((
            StatusCode::UNAUTHORIZED,
            Json(Status {
                status: "unauthorized",
            }),
        ))
    }
}

async fn list_repos(headers: HeaderMap, state: State<Arc<ApiState>>) -> impl IntoResponse {
    if guard(headers, state).await.is_err() {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    Json(serde_json::json!({"repos":[]})).into_response()
}
async fn register_repo(headers: HeaderMap, state: State<Arc<ApiState>>) -> impl IntoResponse {
    if guard(headers, state).await.is_err() {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    Json(Status { status: "accepted" }).into_response()
}
async fn run_impact(headers: HeaderMap, state: State<Arc<ApiState>>) -> impl IntoResponse {
    if guard(headers, state).await.is_err() {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    Json(serde_json::json!({"status":"ok","ai_calls":0})).into_response()
}
async fn discover_edges(headers: HeaderMap, state: State<Arc<ApiState>>) -> impl IntoResponse {
    if guard(headers, state).await.is_err() {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    Json(serde_json::json!({"status":"ok","static_edges":0,"ai_edges_suggested":0,"ai_cost":0.0}))
        .into_response()
}
async fn feedback(headers: HeaderMap, state: State<Arc<ApiState>>) -> impl IntoResponse {
    if guard(headers, state).await.is_err() {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    Json(Status { status: "recorded" }).into_response()
}
async fn ai_stats(headers: HeaderMap, state: State<Arc<ApiState>>) -> impl IntoResponse {
    if guard(headers, state).await.is_err() {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    Json(AiStats::default()).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
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

    async fn send_get(app: Router, path: &str, api_key: Option<&str>) -> (StatusCode, serde_json::Value) {
        let mut req = Request::builder().uri(path).body(Body::empty()).unwrap();
        if let Some(key) = api_key {
            req.headers_mut().insert("x-api-key", key.parse().unwrap());
        }
        let resp = app.oneshot(req).await.unwrap();
        let status = resp.status();
        let bytes = axum::body::to_bytes(resp.into_body(), 1024 * 1024).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
        (status, body)
    }

    async fn send_post(app: Router, path: &str, api_key: Option<&str>) -> (StatusCode, serde_json::Value) {
        let mut req = Request::builder().method("POST").uri(path).body(Body::empty()).unwrap();
        if let Some(key) = api_key {
            req.headers_mut().insert("x-api-key", key.parse().unwrap());
        }
        let resp = app.oneshot(req).await.unwrap();
        let status = resp.status();
        let bytes = axum::body::to_bytes(resp.into_body(), 1024 * 1024).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
        (status, body)
    }

    #[test]
    fn router_builds_with_all_core_routes() {
        let _ = api_router(no_auth_config());
    }

    #[tokio::test]
    async fn list_repos_no_auth_returns_empty_list() {
        let app = api_router(no_auth_config());
        let (status, body) = send_get(app, "/v1/repos", None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["repos"], serde_json::json!([]));
    }

    #[tokio::test]
    async fn register_repo_no_auth_returns_accepted() {
        let app = api_router(no_auth_config());
        let (status, body) = send_post(app, "/v1/repos", None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["status"], "accepted");
    }

    #[tokio::test]
    async fn run_impact_no_auth_returns_ok() {
        let app = api_router(no_auth_config());
        let (status, body) = send_post(app, "/v1/impact", None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["status"], "ok");
        assert_eq!(body["ai_calls"], 0);
    }

    #[tokio::test]
    async fn discover_edges_no_auth_returns_ok() {
        let app = api_router(no_auth_config());
        let (status, body) = send_post(app, "/v1/discover-edges", None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["status"], "ok");
    }

    #[tokio::test]
    async fn feedback_no_auth_returns_recorded() {
        let app = api_router(no_auth_config());
        let (status, body) = send_post(app, "/v1/feedback", None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["status"], "recorded");
    }

    #[tokio::test]
    async fn ai_stats_no_auth_returns_defaults() {
        let app = api_router(no_auth_config());
        let (status, body) = send_get(app, "/v1/ai-stats", None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["invocations"], 0);
        assert_eq!(body["total_cost_usd"], 0.0);
    }

    #[tokio::test]
    async fn unauthorized_without_api_key_when_auth_enabled() {
        let app = api_router(auth_config());
        let (status, _) = send_get(app, "/v1/repos", None).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn authorized_with_correct_api_key() {
        let app = api_router(auth_config());
        let (status, body) = send_get(app, "/v1/repos", Some("secret-key")).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["repos"], serde_json::json!([]));
    }

    #[tokio::test]
    async fn unauthorized_with_wrong_api_key() {
        let app = api_router(auth_config());
        let (status, _) = send_get(app, "/v1/repos", Some("wrong-key")).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn post_endpoints_require_auth_when_enabled() {
        for path in &["/v1/repos", "/v1/impact", "/v1/discover-edges", "/v1/feedback"] {
            let app = api_router(auth_config());
            let (status, _) = send_post(app, path, None).await;
            assert_eq!(status, StatusCode::UNAUTHORIZED, "POST {} should require auth", path);
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

    #[test]
    fn api_state_debug() {
        let state = ApiState {
            config: no_auth_config(),
        };
        assert!(format!("{:?}", state).contains("ApiState"));
    }
}
