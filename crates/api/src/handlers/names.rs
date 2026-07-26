use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json};
use rustrict::CensorStr;
use serde::Deserialize;
use std::sync::Arc;
use uuid::Uuid;

use crate::handlers::submissions::ApiError;
use crate::ratelimit::check_rate_limit;
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct ClaimNameRequest {
    pub player_uuid: Uuid,
    pub name: String,
    pub recovery_phrase_hash: Option<String>,
}

#[derive(Debug, serde::Serialize)]
pub struct ClaimNameResponse {
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct GetNameQuery {
    pub uuid: Uuid,
}

#[derive(Debug, serde::Serialize)]
pub struct GetNameResponse {
    pub name: Option<String>,
}

pub async fn post_name(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ClaimNameRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let name = body.name.trim();

    if name.is_empty() || name.len() > 20 {
        return Err(ApiError {
            status: StatusCode::BAD_REQUEST,
            message: "name must be 1-20 characters".into(),
            ..Default::default()
        });
    }

    // Profanity filter: basic blocklist check
    if contains_profanity(name) {
        return Err(ApiError {
            status: StatusCode::BAD_REQUEST,
            message: "name not allowed".into(),
            ..Default::default()
        });
    }

    // Rate limit: 3 name attempts per UUID per hour (rl:name:{uuid})
    {
        let mut conn = state.redis.get().await.map_err(|e| {
            tracing::error!(error = %e, "Redis pool get failed");
            ApiError {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                message: "rate limit error".into(),
                ..Default::default()
            }
        })?;
        let outcome =
            check_rate_limit(&mut conn, "rl:name", &body.player_uuid.to_string(), 3, 3600).await;
        if !outcome.allowed {
            return Err(ApiError {
                status: StatusCode::TOO_MANY_REQUESTS,
                message: "rate limit exceeded".into(),
                retry_after: Some(outcome.retry_after_secs),
            });
        }
    }

    // Ensure player exists
    let player_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM players WHERE player_uuid = $1)")
            .bind(body.player_uuid)
            .fetch_one(&state.pool)
            .await
            .map_err(|e| ApiError {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                message: format!("db error: {e}"),
                ..Default::default()
            })?;

    if !player_exists {
        return Err(ApiError {
            status: StatusCode::NOT_FOUND,
            message: "player not found".into(),
            ..Default::default()
        });
    }

    let name_lower = name.to_lowercase();

    // Try to insert or update
    let result = sqlx::query(
        "INSERT INTO names (player_uuid, name, name_lowercase, recovery_phrase_hash)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (player_uuid) DO UPDATE
           SET name = EXCLUDED.name,
               name_lowercase = EXCLUDED.name_lowercase,
               recovery_phrase_hash = COALESCE(EXCLUDED.recovery_phrase_hash, names.recovery_phrase_hash),
               updated_at = now()
         WHERE names.updated_at IS NULL OR now() - names.updated_at > interval '24 hours'",
    )
    .bind(body.player_uuid)
    .bind(name)
    .bind(&name_lower)
    .bind(&body.recovery_phrase_hash)
    .execute(&state.pool)
    .await
    .map_err(|e| {
        if let sqlx::Error::Database(ref db_err) = e {
            if db_err.code().as_deref() == Some("23505") {
                return ApiError {
                    status: StatusCode::CONFLICT,
                    message: "name already taken".into(),
                    ..Default::default()
                };
            }
        }
        ApiError {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: format!("db error: {e}"),
            ..Default::default()
        }
    })?;

    if result.rows_affected() == 0 {
        // ON CONFLICT WHERE clause didn't match — 24h cooldown
        return Err(ApiError {
            status: StatusCode::TOO_MANY_REQUESTS,
            message: "name can only be changed once per 24 hours".into(),
            ..Default::default()
        });
    }

    Ok((
        StatusCode::OK,
        Json(ClaimNameResponse { name: name.into() }),
    ))
}

fn contains_profanity(name: &str) -> bool {
    name.is_inappropriate()
}

pub async fn get_name(
    State(state): State<Arc<AppState>>,
    Query(query): Query<GetNameQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let name: Option<String> = sqlx::query_scalar("SELECT name FROM names WHERE player_uuid = $1")
        .bind(query.uuid)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| ApiError {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: format!("db error: {e}"),
            ..Default::default()
        })?;

    Ok((StatusCode::OK, Json(GetNameResponse { name })))
}
