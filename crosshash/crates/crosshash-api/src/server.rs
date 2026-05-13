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
    #[test]
    fn router_builds_with_all_core_routes() {
        let _ = api_router(ApiConfig {
            api_key: None,
            max_requests_per_minute: 60,
        });
    }
}
