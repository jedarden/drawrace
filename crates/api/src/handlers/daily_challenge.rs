use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json};
use chrono::{Datelike, Utc};
use serde::{Deserialize, Serialize};
use std::hash::{Hash, Hasher};
use std::sync::Arc;
use uuid::Uuid;

use crate::handlers::submissions::ApiError;
use crate::AppState;

/// Simple deterministic PRNG for seeding daily challenge modifiers
/// Uses a linear congruential generator for reproducibility
struct SeededRng {
    state: u64,
}

impl SeededRng {
    fn from_date(date: &str) -> Self {
        // Hash the date string to get a seed
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        date.hash(&mut hasher);
        let seed = hasher.finish();
        Self { state: seed.wrapping_add(1) }
    }

    fn next(&mut self) -> u64 {
        // LCG parameters from Numerical Recipes (public domain)
        const A: u64 = 1664525;
        const C: u64 = 1013904223;
        self.state = self.state.wrapping_mul(A).wrapping_add(C);
        self.state
    }

    /// Generate a value in the range [min, max] with 1 decimal place precision
    fn range_f64(&mut self, min: f64, max: f64) -> f64 {
        let range = max - min;
        let resolution = 10.0; // 1 decimal place
        let steps = (range * resolution) as u64;
        let step = self.next() % (steps + 1);
        min + (step as f64 / resolution)
    }
}

#[derive(Debug, Serialize)]
pub struct DailyChallengeResponse {
    pub challenge_date: String, // ISO 8601 date
    pub track_id: i16,
    pub modifiers: ChallengeModifiers,
}

#[derive(Debug, Serialize)]
pub struct ChallengeModifiers {
    pub gravity_multiplier: f64,
    pub friction_multiplier: f64,
    pub chassis_mass_multiplier: f64,
}

#[derive(Debug, Deserialize)]
pub struct DailyChallengeQuery {
    pub date: Option<String>, // ISO 8601 date, defaults to today UTC
}

/// Get the current (or specified) daily challenge configuration
pub async fn get_daily_challenge(
    State(state): State<Arc<AppState>>,
    Query(query): Query<DailyChallengeQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let target_date = query.date.unwrap_or_else(|| {
        let now = Utc::now();
        format!("{:04}-{:02}-{:02}", now.year(), now.month(), now.day())
    });

    // Try to fetch existing challenge for the date
    let row: Option<(i16, f64, f64, f64)> = sqlx::query_as(
        "SELECT track_id, gravity_multiplier, friction_multiplier, chassis_mass_multiplier
         FROM daily_challenges WHERE challenge_date = $1",
    )
    .bind(&target_date)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        message: format!("db error: {e}"),
    })?;

    let (track_id, grav, fric, mass) = if let Some(r) = row {
        r
    } else {
        // No challenge exists for this date - create one with seeded modifiers
        let mut rng = SeededRng::from_date(&target_date);

        // Pick a track (1-3) based on the date seed
        let track_id: i16 = (1 + (rng.next() % 3)) as i16;

        // Generate seeded modifiers:
        // - gravity: 0.7 to 1.5 (affects jump height and fall speed)
        // - friction: 0.5 to 1.5 (affects grip and sliding)
        // - chassis mass: 0.8 to 1.5 (affects momentum and stability)
        let grav = rng.range_f64(0.7, 1.5);
        let fric = rng.range_f64(0.5, 1.5);
        let mass = rng.range_f64(0.8, 1.5);

        sqlx::query(
            "INSERT INTO daily_challenges (challenge_date, track_id, gravity_multiplier, friction_multiplier, chassis_mass_multiplier)
             VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(&target_date)
        .bind(track_id)
        .bind(grav)
        .bind(fric)
        .bind(mass)
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: format!("db error: {e}"),
        })?;

        (track_id, grav, fric, mass)
    };

    Ok((
        StatusCode::OK,
        Json(DailyChallengeResponse {
            challenge_date: target_date,
            track_id,
            modifiers: ChallengeModifiers {
                gravity_multiplier: grav,
                friction_multiplier: fric,
                chassis_mass_multiplier: mass,
            },
        }),
    ))
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

#[derive(Debug, Serialize)]
pub struct DailyLeaderboardTopResponse {
    pub challenge_date: String,
    pub track_id: i16,
    pub modifiers: ChallengeModifiers,
    pub entries: Vec<LeaderboardEntry>,
}

#[derive(Debug, Deserialize)]
pub struct TopQuery {
    #[serde(default = "default_limit")]
    pub limit: i64,
}

fn default_limit() -> i64 {
    10
}

/// Get top entries for a daily challenge leaderboard
pub async fn get_daily_top(
    State(state): State<Arc<AppState>>,
    Path(date): Path<String>,
    Query(query): Query<TopQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let limit = query.limit.clamp(1, 100);

    // Get challenge info first
    let challenge_row: Option<(i16, f64, f64, f64)> = sqlx::query_as(
        "SELECT track_id, gravity_multiplier, friction_multiplier, chassis_mass_multiplier
         FROM daily_challenges WHERE challenge_date = $1",
    )
    .bind(&date)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        message: format!("db error: {e}"),
    })?;

    let (track_id, grav, fric, mass) = challenge_row.ok_or_else(|| ApiError {
        status: StatusCode::NOT_FOUND,
        message: "No daily challenge found for this date".to_string(),
    })?;

    let rows: Vec<(Uuid, Option<String>, i32)> = sqlx::query_as(
        "SELECT g.ghost_id, n.name, g.time_ms
         FROM ghosts g
         LEFT JOIN names n ON n.player_uuid = g.player_uuid
         WHERE g.daily_challenge_date = $1 AND g.is_pb = true AND g.is_legacy = false
         ORDER BY g.time_ms ASC
         LIMIT $2",
    )
    .bind(&date)
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
        Json(DailyLeaderboardTopResponse {
            challenge_date: date,
            track_id,
            modifiers: ChallengeModifiers {
                gravity_multiplier: grav,
                friction_multiplier: fric,
                chassis_mass_multiplier: mass,
            },
            entries,
        }),
    ))
}

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
pub struct DailyLeaderboardContextResponse {
    pub challenge_date: String,
    pub track_id: i16,
    pub modifiers: ChallengeModifiers,
    pub player_rank: Option<i64>,
    pub entries: Vec<LeaderboardEntry>,
}

/// Get context window for a daily challenge leaderboard
pub async fn get_daily_context(
    State(state): State<Arc<AppState>>,
    Path(date): Path<String>,
    Query(query): Query<ContextQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let window = query.window.clamp(1, 50);

    // Get challenge info first
    let challenge_row: Option<(i16, f64, f64, f64)> = sqlx::query_as(
        "SELECT track_id, gravity_multiplier, friction_multiplier, chassis_mass_multiplier
         FROM daily_challenges WHERE challenge_date = $1",
    )
    .bind(&date)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        message: format!("db error: {e}"),
    })?;

    let (track_id, grav, fric, mass) = challenge_row.ok_or_else(|| ApiError {
        status: StatusCode::NOT_FOUND,
        message: "No daily challenge found for this date".to_string(),
    })?;

    // Check if player has a PB on this daily challenge
    let player_best: Option<(i32,)> = sqlx::query_as(
        "SELECT MIN(time_ms) FROM ghosts
         WHERE player_uuid = $1 AND daily_challenge_date = $2 AND is_pb = true AND is_legacy = false",
    )
    .bind(query.player_uuid)
    .bind(&date)
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
                 WHERE daily_challenge_date = $1 AND is_pb = true AND is_legacy = false AND time_ms < $2",
            )
            .bind(&date)
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
         WHERE g.daily_challenge_date = $1 AND g.is_pb = true AND is_legacy = false
         ORDER BY g.time_ms ASC
         LIMIT $3 OFFSET $4",
    )
    .bind(&date)
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
        Json(DailyLeaderboardContextResponse {
            challenge_date: date,
            track_id,
            modifiers: ChallengeModifiers {
                gravity_multiplier: grav,
                friction_multiplier: fric,
                chassis_mass_multiplier: mass,
            },
            player_rank,
            entries,
        }),
    ))
}
