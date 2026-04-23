use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use sqlx::Row;
use std::sync::Arc;
use uuid::Uuid;

use crate::handlers::submissions::ApiError;
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct FeedbackRequest {
    pub category: String,
    pub body: String,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, serde::Serialize)]
pub struct FeedbackResponse {
    pub id: i64,
}

pub async fn post_feedback(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<FeedbackRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let player_uuid = headers
        .get("X-DrawRace-Player")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| Uuid::parse_str(v).ok());

    let valid_categories = ["bug", "feature", "other"];
    if !valid_categories.contains(&payload.category.as_str()) {
        return Err(ApiError {
            status: axum::http::StatusCode::BAD_REQUEST,
            message: "category must be bug, feature, or other".into(),
        });
    }

    if payload.body.is_empty() || payload.body.len() > 5000 {
        return Err(ApiError {
            status: axum::http::StatusCode::BAD_REQUEST,
            message: "body must be 1-5000 characters".into(),
        });
    }

    // Rate limit: 10 feedback submissions per UUID per hour
    if let Some(uuid) = player_uuid {
        let mut conn = state.redis.get().await.map_err(|e| {
            tracing::error!(error = %e, "Redis pool get failed");
            ApiError {
                status: axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                message: "rate limit error".into(),
            }
        })?;
        let rl_key = format!("rl:feedback:{}", uuid);
        let count: i64 = redis::cmd("INCR")
            .arg(&rl_key)
            .query_async(&mut conn)
            .await
            .unwrap_or(0);

        if count == 1 {
            use redis::AsyncCommands;
            let _: () = conn.expire(&rl_key, 3600).await.unwrap_or(());
        }

        if count > 10 {
            return Err(ApiError {
                status: axum::http::StatusCode::TOO_MANY_REQUESTS,
                message: "rate limit exceeded".into(),
            });
        }
    }

    let row = sqlx::query(
        "INSERT INTO feedback (player_uuid, category, body, metadata)
         VALUES ($1, $2, $3, $4)
         RETURNING id",
    )
    .bind(player_uuid)
    .bind(&payload.category)
    .bind(&payload.body)
    .bind(&payload.metadata)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "failed to insert feedback");
        ApiError {
            status: axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            message: "db error".into(),
        }
    })?;

    let id: i64 = row.get("id");

    metrics::counter!("drawrace_feedback_total", "category" => payload.category.clone()).increment(1);

    Ok((axum::http::StatusCode::CREATED, Json(FeedbackResponse { id })))
}
