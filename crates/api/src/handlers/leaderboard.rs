use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

use crate::handlers::submissions::ApiError;
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct ContextQuery {
    pub player_uuid: Uuid,
    #[serde(default = "default_window")]
    pub window: i64,
}

fn default_window() -> i64 {
    5
}

#[derive(Debug, Serialize)]
pub struct LeaderboardContextResponse {
    pub track_id: i16,
    pub player_rank: Option<i64>,
    pub entries: Vec<LeaderboardEntry>,
}

#[derive(Debug, Serialize)]
pub struct LeaderboardEntry {
    pub rank: i64,
    pub name: String,
    pub time_ms: i32,
    pub ghost_id: Uuid,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_self: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct TopQuery {
    #[serde(default = "default_limit")]
    pub limit: i64,
}

fn default_limit() -> i64 {
    10
}

#[derive(Debug, Serialize)]
pub struct LeaderboardTopResponse {
    pub track_id: i16,
    pub entries: Vec<LeaderboardEntry>,
}

pub async fn get_top(
    State(state): State<Arc<AppState>>,
    Path(track_id): Path<i16>,
    Query(query): Query<TopQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let limit = query.limit.clamp(1, 100);

    let rows: Vec<(Uuid, Option<String>, i32)> = sqlx::query_as(
        "SELECT g.ghost_id, n.name, g.time_ms
         FROM ghosts g
         LEFT JOIN names n ON n.player_uuid = g.player_uuid
         WHERE g.track_id = $1 AND g.is_pb = true
         ORDER BY g.time_ms ASC
         LIMIT $2",
    )
    .bind(track_id)
    .bind(limit)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        message: format!("db error: {e}"),
    })?;

    let entries: Vec<LeaderboardEntry> = rows
        .into_iter()
        .enumerate()
        .map(|(i, (ghost_id, name, time_ms))| LeaderboardEntry {
            rank: 1 + i as i64,
            name: name.unwrap_or_else(|| "GhostUser".into()),
            time_ms,
            ghost_id,
            is_self: None,
        })
        .collect();

    Ok((
        StatusCode::OK,
        Json(LeaderboardTopResponse { track_id, entries }),
    ))
}

pub async fn get_context(
    State(state): State<Arc<AppState>>,
    Path(track_id): Path<i16>,
    Query(query): Query<ContextQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let window = query.window.clamp(1, 50);

    // Check if player has a PB on this track
    let player_best: Option<(i32,)> = sqlx::query_as(
        "SELECT MIN(time_ms) FROM ghosts
         WHERE player_uuid = $1 AND track_id = $2 AND is_pb = true",
    )
    .bind(query.player_uuid)
    .bind(track_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        message: format!("db error: {e}"),
    })?;

    let player_best_time = match player_best {
        Some((t,)) if t > 0 => Some(t),
        _ => None,
    };

    let player_rank = match player_best_time {
        Some(best) => {
            let rank: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) + 1 FROM ghosts
                 WHERE track_id = $1 AND is_pb = true AND time_ms < $2",
            )
            .bind(track_id)
            .bind(best)
            .fetch_one(&state.pool)
            .await
            .map_err(|e| ApiError {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                message: format!("db error: {e}"),
            })?;
            Some(rank)
        }
        None => None,
    };

    let (start, limit) = match player_rank {
        Some(center) => {
            let s = (center - window).max(1);
            let l = window * 2 + 1;
            (s, l)
        }
        None => (1i64, window * 2),
    };

    // Single query fetching entries with is_self flag
    let rows: Vec<(Uuid, Option<String>, i32, bool)> = sqlx::query_as(
        "SELECT g.ghost_id, n.name, g.time_ms,
                (g.player_uuid = $2) AS is_self
         FROM ghosts g
         LEFT JOIN names n ON n.player_uuid = g.player_uuid
         WHERE g.track_id = $1 AND g.is_pb = true
         ORDER BY g.time_ms ASC
         LIMIT $3 OFFSET $4",
    )
    .bind(track_id)
    .bind(query.player_uuid)
    .bind(limit)
    .bind(start - 1)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        message: format!("db error: {e}"),
    })?;

    let entries: Vec<LeaderboardEntry> = rows
        .into_iter()
        .enumerate()
        .map(|(i, (ghost_id, name, time_ms, is_self))| LeaderboardEntry {
            rank: start + i as i64,
            name: name.unwrap_or_else(|| "GhostUser".into()),
            time_ms,
            ghost_id,
            is_self: if is_self { Some(true) } else { None },
        })
        .collect();

    Ok((
        StatusCode::OK,
        Json(LeaderboardContextResponse {
            track_id,
            player_rank,
            entries,
        }),
    ))
}
