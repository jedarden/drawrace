use axum::extract::State;
use axum::response::IntoResponse;
use std::sync::Arc;

use crate::AppState;

pub async fn metrics_handler(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let body = state.metrics_handle.render();
    (
        axum::http::StatusCode::OK,
        [("content-type", "text/plain; version=0.0.4; charset=utf-8")],
        body,
    )
}
