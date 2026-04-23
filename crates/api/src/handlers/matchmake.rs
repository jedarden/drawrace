use aws_sdk_s3::presigning::PresigningConfig;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use uuid::Uuid;

use crate::handlers::submissions::ApiError;
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct MatchmakeQuery {
    pub player_uuid: Uuid,
}

#[derive(Debug, Serialize)]
pub struct MatchmakeResponse {
    pub track_id: i16,
    pub player_bucket: String,
    pub target_bucket: String,
    pub ghosts: Vec<MatchmakeGhost>,
    pub shadow_ghost: Option<MatchmakeGhost>,
    pub expires_at: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct MatchmakeGhost {
    pub ghost_id: Uuid,
    pub time_ms: i32,
    pub name: String,
    pub url: String,
}

// Bucket order from fastest to slowest
const BUCKET_ORDER: &[&str] = &["elite", "advanced", "skilled", "mid", "novice"];

fn percentile_to_bucket(pr: f64) -> &'static str {
    if pr <= 0.01 {
        "elite"
    } else if pr <= 0.05 {
        "advanced"
    } else if pr <= 0.20 {
        "skilled"
    } else if pr <= 0.50 {
        "mid"
    } else {
        "novice"
    }
}

fn next_faster_bucket(bucket: &str) -> Option<&'static str> {
    BUCKET_ORDER
        .iter()
        .position(|b| *b == bucket)
        .and_then(|i| {
            if i == 0 {
                None // elite -> stays elite
            } else {
                Some(BUCKET_ORDER[i - 1])
            }
        })
}

pub async fn get_matchmake(
    State(state): State<Arc<AppState>>,
    Path(track_id): Path<i16>,
    Query(query): Query<MatchmakeQuery>,
) -> Result<impl IntoResponse, ApiError> {
    // Rate limit: 60 requests/minute per player UUID
    {
        let mut conn = state.redis.get().await.map_err(|e| {
            tracing::error!(error = %e, "Redis pool get failed");
            ApiError {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                message: "rate limit error".into(),
            }
        })?;
        let rl_key = format!("rl:matchmake:{}", query.player_uuid);
        let count: i64 = redis::cmd("INCR")
            .arg(&rl_key)
            .query_async(&mut conn)
            .await
            .unwrap_or(0);

        if count == 1 {
            redis::cmd("EXPIRE")
                .arg(&rl_key)
                .arg(60i64)
                .exec_async(&mut conn)
                .await
                .ok();
        }

        if count > 60 {
            return Err(ApiError {
                status: StatusCode::TOO_MANY_REQUESTS,
                message: "rate limit exceeded".into(),
            });
        }
    }

    // Refresh the materialized view to get latest bucket data
    sqlx::query("REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_buckets")
        .execute(&state.pool)
        .await
        .ok(); // Ignore errors — stale view is acceptable

    // Find player's PB bucket
    let player_row: Option<(f64,)> = sqlx::query_as(
        "SELECT pr FROM leaderboard_buckets
         WHERE player_uuid = $1 AND track_id = $2
         ORDER BY pr ASC LIMIT 1",
    )
    .bind(query.player_uuid)
    .bind(track_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        message: format!("db error: {e}"),
    })?;

    let player_bucket = match player_row {
        Some((pr,)) => percentile_to_bucket(pr).to_string(),
        None => "novice".to_string(),
    };

    // Target bucket: one tier faster, clamped at elite
    let target_bucket = if player_bucket == "elite" {
        "elite".to_string()
    } else {
        next_faster_bucket(&player_bucket)
            .unwrap_or("elite")
            .to_string()
    };

    // Fetch 3 ghosts from target bucket (with fallback chain)
    let ghosts = fetch_ghosts_with_fallback(
        &state,
        track_id,
        &target_bucket,
        query.player_uuid,
        3,
    )
    .await?;

    // Track bucket misses for dashboard alerting
    if ghosts.len() < 3 {
        metrics::counter!("drawrace_matchmake_bucket_miss_total", "target_bucket" => target_bucket.clone()).increment(1);
    }

    // Fetch player's shadow ghost (their PB on this track)
    let shadow_ghost = fetch_shadow_ghost(&state, track_id, query.player_uuid).await?;

    let expires_at = chrono::Utc::now() + chrono::Duration::minutes(5);

    Ok((
        StatusCode::OK,
        Json(MatchmakeResponse {
            track_id,
            player_bucket,
            target_bucket,
            ghosts,
            shadow_ghost,
            expires_at: expires_at.to_rfc3339(),
        }),
    ))
}

async fn fetch_ghosts_with_fallback(
    state: &Arc<AppState>,
    track_id: i16,
    start_bucket: &str,
    exclude_player: Uuid,
    count: i64,
) -> Result<Vec<MatchmakeGhost>, ApiError> {
    let bucket_idx = BUCKET_ORDER
        .iter()
        .position(|b| *b == start_bucket)
        .unwrap_or(BUCKET_ORDER.len() - 1);

    let mut ghosts = Vec::new();
    let mut remaining = count;

    // Try each bucket from target upwards (faster), then fall back downwards
    let mut try_order: Vec<usize> = Vec::new();

    // Start from target bucket, try faster buckets first
    for i in (0..=bucket_idx).rev() {
        try_order.push(i);
    }
    // Then try slower buckets as final fallback
    for i in (bucket_idx + 1)..BUCKET_ORDER.len() {
        try_order.push(i);
    }

    for &bucket_idx in &try_order {
        if remaining <= 0 {
            break;
        }
        let bucket = BUCKET_ORDER[bucket_idx];
        let fetched = fetch_ghosts_from_bucket(state, track_id, bucket, exclude_player, remaining)
            .await?;
        remaining -= fetched.len() as i64;
        ghosts.extend(fetched);
    }

    Ok(ghosts)
}

async fn fetch_ghosts_from_bucket(
    state: &Arc<AppState>,
    track_id: i16,
    bucket: &str,
    exclude_player: Uuid,
    limit: i64,
) -> Result<Vec<MatchmakeGhost>, ApiError> {
    let (pr_low, pr_high) = bucket_percentile_range(bucket);

    let rows: Vec<(Uuid, Option<String>, i32, String)> = sqlx::query_as(
        "SELECT g.ghost_id, n.name, g.time_ms, g.s3_key
         FROM leaderboard_buckets lb
         JOIN ghosts g ON g.ghost_id = lb.ghost_id
         LEFT JOIN names n ON n.player_uuid = g.player_uuid
         WHERE lb.track_id = $1
           AND lb.pr > $2 AND lb.pr <= $3
           AND g.player_uuid != $4
         ORDER BY RANDOM()
         LIMIT $5",
    )
    .bind(track_id)
    .bind(pr_low)
    .bind(pr_high)
    .bind(exclude_player)
    .bind(limit)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        message: format!("db error: {e}"),
    })?;

    let mut ghosts = Vec::with_capacity(rows.len());
    for (ghost_id, name, time_ms, s3_key) in rows {
        let url = presign_ghost(&state.s3, &state.s3_bucket, &s3_key).await?;
        ghosts.push(MatchmakeGhost {
            ghost_id,
            time_ms,
            name: name.unwrap_or_else(|| "GhostUser".into()),
            url,
        });
    }

    Ok(ghosts)
}

async fn fetch_shadow_ghost(
    state: &Arc<AppState>,
    track_id: i16,
    player_uuid: Uuid,
) -> Result<Option<MatchmakeGhost>, ApiError> {
    let row: Option<(Uuid, Option<String>, i32, String)> = sqlx::query_as(
        "SELECT g.ghost_id, n.name, g.time_ms, g.s3_key
         FROM ghosts g
         LEFT JOIN names n ON n.player_uuid = g.player_uuid
         WHERE g.player_uuid = $1 AND g.track_id = $2 AND g.is_pb = true
         ORDER BY g.time_ms ASC
         LIMIT 1",
    )
    .bind(player_uuid)
    .bind(track_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        message: format!("db error: {e}"),
    })?;

    match row {
        Some((ghost_id, name, time_ms, s3_key)) => {
            let url = presign_ghost(&state.s3, &state.s3_bucket, &s3_key).await?;
            Ok(Some(MatchmakeGhost {
                ghost_id,
                time_ms,
                name: name.unwrap_or_else(|| "you".into()),
                url,
            }))
        }
        None => Ok(None),
    }
}

async fn presign_ghost(
    s3: &aws_sdk_s3::Client,
    bucket: &str,
    s3_key: &str,
) -> Result<String, ApiError> {
    let presigned = s3
        .get_object()
        .bucket(bucket)
        .key(s3_key)
        .presigned(
            PresigningConfig::expires_in(Duration::from_secs(300))
                .expect("valid presigning duration"),
        )
        .await
        .map_err(|e| {
            tracing::error!(s3_key = %s3_key, error = %e, "S3 presign failed");
            ApiError {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                message: "storage error".into(),
            }
        })?;

    Ok(presigned.uri().to_string())
}

fn bucket_percentile_range(bucket: &str) -> (f64, f64) {
    match bucket {
        "elite" => (-1.0, 0.01),
        "advanced" => (0.01, 0.05),
        "skilled" => (0.05, 0.20),
        "mid" => (0.20, 0.50),
        "novice" => (0.50, 2.0),
        _ => (-1.0, 2.0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percentile_to_bucket_edges() {
        assert_eq!(percentile_to_bucket(0.0), "elite");
        assert_eq!(percentile_to_bucket(0.01), "elite");
        assert_eq!(percentile_to_bucket(0.0101), "advanced");
        assert_eq!(percentile_to_bucket(0.05), "advanced");
        assert_eq!(percentile_to_bucket(0.051), "skilled");
        assert_eq!(percentile_to_bucket(0.20), "skilled");
        assert_eq!(percentile_to_bucket(0.21), "mid");
        assert_eq!(percentile_to_bucket(0.50), "mid");
        assert_eq!(percentile_to_bucket(0.51), "novice");
        assert_eq!(percentile_to_bucket(1.0), "novice");
    }

    #[test]
    fn next_faster_bucket_chain() {
        assert_eq!(next_faster_bucket("elite"), None);
        assert_eq!(next_faster_bucket("advanced"), Some("elite"));
        assert_eq!(next_faster_bucket("skilled"), Some("advanced"));
        assert_eq!(next_faster_bucket("mid"), Some("skilled"));
        assert_eq!(next_faster_bucket("novice"), Some("mid"));
    }

    #[test]
    fn next_faster_bucket_unknown() {
        assert_eq!(next_faster_bucket("does_not_exist"), None);
    }

    #[test]
    fn bucket_percentile_ranges_cover_full_spectrum() {
        let ranges: Vec<(&str, (f64, f64))> = BUCKET_ORDER
            .iter()
            .map(|&b| (b, bucket_percentile_range(b)))
            .collect();

        // Each bucket's upper bound equals the next bucket's lower bound
        for i in 0..ranges.len() - 1 {
            assert_eq!(ranges[i].1 .1, ranges[i + 1].1 .0);
        }

        // Full coverage from -1 to 2.0
        assert_eq!(ranges.first().unwrap().1 .0, -1.0);
        assert_eq!(ranges.last().unwrap().1 .1, 2.0);
    }
}
