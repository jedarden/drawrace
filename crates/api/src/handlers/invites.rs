use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Json};
use axum::Json as AxumJson;
use serde::Deserialize;
use std::sync::Arc;
use uuid::Uuid;

use crate::handlers::submissions::ApiError;
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct RedeemInviteRequest {
    pub code: String,
    pub player_uuid: Uuid,
}

#[derive(Debug, serde::Serialize)]
pub struct RedeemInviteResponse {
    pub valid: bool,
}

/// Redeem an invite code. During beta, this is the gate for API access.
pub async fn post_redeem_invite(
    State(state): State<Arc<AppState>>,
    AxumJson(body): AxumJson<RedeemInviteRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let code = body.code.trim().to_uppercase();

    if code.is_empty() || code.len() > 32 {
        return Err(ApiError {
            status: axum::http::StatusCode::BAD_REQUEST,
            message: "code must be 1-32 characters".into(),
        });
    }

    // Check if invite code exists and hasn't been fully redeemed
    let row: Option<(String, i32, i32)> = sqlx::query_as(
        "SELECT code, max_uses, current_uses FROM invite_codes WHERE code = $1 AND enabled = true",
    )
    .bind(&code)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError {
        status: axum::http::StatusCode::INTERNAL_SERVER_ERROR,
        message: format!("db error: {e}"),
    })?;

    let Some((_code, max_uses, current_uses)) = row else {
        metrics::counter!("drawrace_invite_redeem_total", "result" => "invalid").increment(1);
        return Ok((
            axum::http::StatusCode::OK,
            Json(RedeemInviteResponse { valid: false }),
        ));
    };

    if current_uses >= max_uses {
        metrics::counter!("drawrace_invite_redeem_total", "result" => "exhausted").increment(1);
        return Ok((
            axum::http::StatusCode::OK,
            Json(RedeemInviteResponse { valid: false }),
        ));
    }

    // Check if this player already redeemed any code
    let already_redeemed: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM player_invites WHERE player_uuid = $1)")
            .bind(body.player_uuid)
            .fetch_one(&state.pool)
            .await
            .map_err(|e| ApiError {
                status: axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                message: format!("db error: {e}"),
            })?;

    if already_redeemed {
        // Player already has access — idempotent success
        return Ok((
            axum::http::StatusCode::OK,
            Json(RedeemInviteResponse { valid: true }),
        ));
    }

    // Redeem: increment uses and record player invite
    let mut tx = state.pool.begin().await.map_err(|e| ApiError {
        status: axum::http::StatusCode::INTERNAL_SERVER_ERROR,
        message: format!("db error: {e}"),
    })?;

    let updated = sqlx::query(
        "UPDATE invite_codes SET current_uses = current_uses + 1
         WHERE code = $1 AND current_uses < max_uses AND enabled = true",
    )
    .bind(&code)
    .execute(&mut *tx)
    .await
    .map_err(|e| ApiError {
        status: axum::http::StatusCode::INTERNAL_SERVER_ERROR,
        message: format!("db error: {e}"),
    })?;

    if updated.rows_affected() == 0 {
        tx.rollback().await.ok();
        metrics::counter!("drawrace_invite_redeem_total", "result" => "race").increment(1);
        return Ok((
            axum::http::StatusCode::OK,
            Json(RedeemInviteResponse { valid: false }),
        ));
    }

    sqlx::query("INSERT INTO player_invites (player_uuid, invite_code) VALUES ($1, $2)")
        .bind(body.player_uuid)
        .bind(&code)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError {
            status: axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            message: format!("db error: {e}"),
        })?;

    tx.commit().await.map_err(|e| ApiError {
        status: axum::http::StatusCode::INTERNAL_SERVER_ERROR,
        message: format!("db error: {e}"),
    })?;

    metrics::counter!("drawrace_invite_redeem_total", "result" => "success").increment(1);

    Ok((
        axum::http::StatusCode::OK,
        Json(RedeemInviteResponse { valid: true }),
    ))
}

/// Check if a player has beta access (redeemed an invite code).
pub async fn get_invite_status(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    let player_uuid = headers
        .get("X-DrawRace-Player")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| Uuid::parse_str(v).ok());

    let Some(uuid) = player_uuid else {
        return Ok((
            axum::http::StatusCode::OK,
            Json(serde_json::json!({ "has_access": false })),
        ));
    };

    let has_access: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM player_invites WHERE player_uuid = $1)")
            .bind(uuid)
            .fetch_one(&state.pool)
            .await
            .map_err(|e| ApiError {
                status: axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                message: format!("db error: {e}"),
            })?;

    Ok((
        axum::http::StatusCode::OK,
        Json(serde_json::json!({ "has_access": has_access })),
    ))
}
