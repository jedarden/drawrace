use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json};
use redis::AsyncCommands;
use serde::Deserialize;
use std::sync::Arc;
use uuid::Uuid;

use crate::handlers::submissions::ApiError;
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct ClaimNameRequest {
    pub player_uuid: Uuid,
    pub name: String,
}

#[derive(Debug, serde::Serialize)]
pub struct ClaimNameResponse {
    pub name: String,
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
        });
    }

    // Profanity filter: basic blocklist check
    if contains_profanity(name) {
        return Err(ApiError {
            status: StatusCode::BAD_REQUEST,
            message: "name not allowed".into(),
        });
    }

    // Rate limit: 3 name attempts per UUID per hour
    {
        let mut conn = state.redis.get().await.map_err(|e| {
            tracing::error!(error = %e, "Redis pool get failed");
            ApiError {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                message: "rate limit error".into(),
            }
        })?;
        let rl_key = format!("rl:name:{}", body.player_uuid);
        let count: i64 = redis::cmd("INCR")
            .arg(&rl_key)
            .query_async(&mut conn)
            .await
            .unwrap_or(0);

        if count == 1 {
            let _: () = conn.expire(&rl_key, 3600).await.unwrap_or(());
        }

        if count > 3 {
            return Err(ApiError {
                status: StatusCode::TOO_MANY_REQUESTS,
                message: "rate limit exceeded".into(),
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
            })?;

    if !player_exists {
        return Err(ApiError {
            status: StatusCode::NOT_FOUND,
            message: "player not found".into(),
        });
    }

    let name_lower = name.to_lowercase();

    // Try to insert or update
    let result = sqlx::query(
        "INSERT INTO names (player_uuid, name, name_lowercase)
         VALUES ($1, $2, $3)
         ON CONFLICT (player_uuid) DO UPDATE
           SET name = EXCLUDED.name,
               name_lowercase = EXCLUDED.name_lowercase,
               updated_at = now()
         WHERE names.updated_at IS NULL OR now() - names.updated_at > interval '24 hours'",
    )
    .bind(body.player_uuid)
    .bind(name)
    .bind(&name_lower)
    .execute(&state.pool)
    .await
    .map_err(|e| {
        if let sqlx::Error::Database(ref db_err) = e {
            if db_err.code().as_deref() == Some("23505") {
                return ApiError {
                    status: StatusCode::CONFLICT,
                    message: "name already taken".into(),
                };
            }
        }
        ApiError {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: format!("db error: {e}"),
        }
    })?;

    if result.rows_affected() == 0 {
        // ON CONFLICT WHERE clause didn't match — 24h cooldown
        return Err(ApiError {
            status: StatusCode::TOO_MANY_REQUESTS,
            message: "name can only be changed once per 24 hours".into(),
        });
    }

    Ok((
        StatusCode::OK,
        Json(ClaimNameResponse { name: name.into() }),
    ))
}

fn contains_profanity(name: &str) -> bool {
    let lower = name.to_lowercase();
    const BLOCKLIST: &[&str] = &[
        "fuck", "shit", "ass", "bitch", "cunt", "dick", "nigger", "nazi", "hitler", "rape", "pedo",
        "kill", "die",
    ];
    BLOCKLIST.iter().any(|w| lower.contains(w))
}
