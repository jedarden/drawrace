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
pub struct CrashReport {
    pub message: String,
    pub stack: Option<String>,
    pub url: Option<String>,
    pub line: Option<u32>,
    pub column: Option<u32>,
    pub user_agent: Option<String>,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, serde::Serialize)]
pub struct CrashReportResponse {
    pub id: i64,
}

pub async fn post_crash_report(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<CrashReport>,
) -> Result<impl IntoResponse, ApiError> {
    let player_uuid = headers
        .get("X-DrawRace-Player")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| Uuid::parse_str(v).ok());

    if payload.message.is_empty() || payload.message.len() > 10000 {
        return Err(ApiError {
            status: axum::http::StatusCode::BAD_REQUEST,
            message: "message must be 1-10000 characters".into(),
        });
    }

    // Rate limit: 20 crash reports per UUID per hour
    if let Some(uuid) = player_uuid {
        let mut conn = state.redis.get().await.map_err(|e| {
            tracing::error!(error = %e, "Redis pool get failed");
            ApiError {
                status: axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                message: "rate limit error".into(),
            }
        })?;
        let rl_key = format!("rl:crash:{}", uuid);
        let count: i64 = redis::cmd("INCR")
            .arg(&rl_key)
            .query_async(&mut conn)
            .await
            .unwrap_or(0);

        if count == 1 {
            use redis::AsyncCommands;
            let _: () = conn.expire(&rl_key, 3600).await.unwrap_or(());
        }

        if count > 20 {
            return Err(ApiError {
                status: axum::http::StatusCode::TOO_MANY_REQUESTS,
                message: "rate limit exceeded".into(),
            });
        }
    }

    let row = sqlx::query(
        "INSERT INTO crash_reports (player_uuid, message, stack, url, line, column, user_agent, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id",
    )
    .bind(player_uuid)
    .bind(&payload.message)
    .bind(&payload.stack)
    .bind(&payload.url)
    .bind(payload.line.map(|l| l as i32))
    .bind(payload.column.map(|c| c as i32))
    .bind(&payload.user_agent)
    .bind(&payload.metadata)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "failed to insert crash report");
        ApiError {
            status: axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            message: "db error".into(),
        }
    })?;

    let id: i64 = row.get("id");

    metrics::counter!("drawrace_crash_reports_total").increment(1);

    Ok((axum::http::StatusCode::CREATED, Json(CrashReportResponse { id })))
}
