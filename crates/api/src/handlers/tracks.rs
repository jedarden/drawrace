use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
    Json as JsonType,
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::sync::Arc;
use uuid::Uuid;

use crate::AppState;

#[derive(Debug, Serialize, Deserialize)]
pub struct TrackSubmission {
    pub id: String,
    pub numeric_id: i32,
    pub name: String,
    pub version: i32,
    pub world: WorldConfig,
    pub camera: CameraConfig,
    pub terrain: Vec<TerrainPoint>,
    pub surfaces: Vec<SurfaceSegment>,
    pub obstacles: Vec<Obstacle>,
    pub ramps: Vec<Ramp>,
    pub hazards: Vec<Hazard>,
    pub zones: Vec<Zone>,
    pub start: StartPosition,
    pub finish: FinishLine,
    pub metadata: TrackMetadata,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WorldConfig {
    pub gravity: [f64; 2],
    pub pixelsPerMeter: i32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CameraConfig {
    pub followAxis: String,
    pub deadzone: [i32; 2],
    pub maxZoomOut: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TerrainPoint {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SurfaceSegment {
    pub x_range: [f64; 2],
    #[serde(rename = "type")]
    pub surface_type: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Obstacle {
    #[serde(rename = "type")]
    pub obstacle_type: String,
    pub pos: [f64; 2],
    pub size: Option<[f64; 2]>,
    pub radius: Option<f64>,
    pub angle: Option<f64>,
    pub friction: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Ramp {
    pub zone: String,
    pub x_start: f64,
    pub x_end: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Hazard {
    #[serde(rename = "type")]
    pub hazard_type: String,
    pub x_start: f64,
    pub x_end: f64,
    pub y: Option<f64>,
    pub depthMeters: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Zone {
    pub id: String,
    pub x_start: f64,
    pub x_end: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StartPosition {
    pub pos: [f64; 2],
    pub facing: i32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FinishLine {
    pub pos: [f64; 2],
    pub width: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TrackMetadata {
    pub targetTimeSeconds: i32,
    pub tutorialGhosts: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct TrackSubmissionResponse {
    pub track_id: String,
    pub status: String,
    pub message: String,
}

#[derive(Debug)]
pub struct ApiError {
    pub status: StatusCode,
    pub message: String,
}

impl axum::response::IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        (
            self.status,
            Json(serde_json::json!({ "error": self.message })),
        )
            .into_response()
    }
}

fn extract_player_uuid(headers: &axum::http::HeaderMap) -> Result<Uuid, ApiError> {
    let val = headers
        .get("X-DrawRace-Player")
        .ok_or_else(|| ApiError {
            status: StatusCode::BAD_REQUEST,
            message: "missing X-DrawRace-Player header".into(),
        })?
        .to_str()
        .map_err(|_| ApiError {
            status: StatusCode::BAD_REQUEST,
            message: "invalid X-DrawRace-Player header".into(),
        })?;

    Uuid::parse_str(val).map_err(|_| ApiError {
        status: StatusCode::BAD_REQUEST,
        message: "invalid player UUID".into(),
    })
}

pub async fn post_track(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
    Json(track): JsonType<TrackSubmission>,
) -> Result<Json<TrackSubmissionResponse>, ApiError> {
    let player_uuid = extract_player_uuid(&headers)?;

    // Generate a unique track ID
    let track_id = Uuid::new_v4();

    // Lazy player registration
    sqlx::query("INSERT INTO players (player_uuid) VALUES ($1) ON CONFLICT DO NOTHING")
        .bind(player_uuid)
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: format!("db error: {e}"),
        })?;

    // Serialize track data to JSON
    let track_json = serde_json::to_vec(&track).map_err(|e| ApiError {
        status: StatusCode::BAD_REQUEST,
        message: format!("invalid track JSON: {e}"),
    })?;

    // Store in S3
    let s3_key = format!("tracks/community/{}.json", track_id);
    state
        .s3
        .put_object()
        .bucket(&state.s3_bucket)
        .key(&s3_key)
        .body(track_json.clone().into())
        .send()
        .await
        .map_err(|e| {
            tracing::error!(s3_key = %s3_key, error = %e, "S3 put failed");
            ApiError {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                message: "storage error".into(),
            }
        })?;

    // Insert into community_tracks table
    let query = r#"
    INSERT INTO community_tracks (id, track_id, player_uuid, track_data, s3_key, status, created_at)
    VALUES ($1, $2, $3, $4, $5, 'pending', NOW())
    RETURNING id
  "#;

    sqlx::query(query)
        .bind(Uuid::new_v4()) // id for database row
        .bind(track_id)
        .bind(player_uuid)
        .bind(serde_json::to_value(&track).map_err(|_| ApiError {
            status: StatusCode::BAD_REQUEST,
            message: "invalid track data".into(),
        })?)
        .bind(&s3_key)
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: format!("db error: {e}"),
        })?;

    metrics::counter!("drawrace_track_submissions_total", "status" => "pending").increment(1);

    Ok(Json(TrackSubmissionResponse {
        track_id: track_id.to_string(),
        status: "pending".to_string(),
        message: "Track submitted for moderation".to_string(),
    }))
}

pub async fn get_pending_tracks(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
) -> Result<Json<Vec<TrackSubmissionResponse>>, ApiError> {
    let _player_uuid = extract_player_uuid(&headers)?;

    let query = r#"
    SELECT track_id, status
    FROM community_tracks
    WHERE status = 'pending'
    ORDER BY created_at DESC
  "#;

    let tracks = sqlx::query_as::<_, (Uuid, String)>(query)
        .fetch_all(&state.pool)
        .await
        .map_err(|e| ApiError {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: format!("db error: {e}"),
        })?
        .into_iter()
        .map(|(track_id, status)| TrackSubmissionResponse {
            track_id: track_id.to_string(),
            status,
            message: "Track awaiting moderation".to_string(),
        })
        .collect();

    Ok(Json(tracks))
}

pub async fn publish_track(
    State(state): State<Arc<AppState>>,
    Path(track_id): Path<Uuid>,
) -> Result<Json<TrackSubmissionResponse>, ApiError> {
    let query = r#"
    UPDATE community_tracks
    SET status = 'published', published_at = NOW()
    WHERE track_id = $1 AND status = 'pending'
    RETURNING track_id
  "#;

    let result = sqlx::query_scalar::<_, Uuid>(query)
        .bind(track_id)
        .fetch_one(&state.pool)
        .await
        .map_err(|e| ApiError {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: format!("db error: {e}"),
        })?;

    metrics::counter!("drawrace_track_moderations_total", "action" => "publish").increment(1);

    Ok(Json(TrackSubmissionResponse {
        track_id: result.to_string(),
        status: "published".to_string(),
        message: "Track published successfully".to_string(),
    }))
}

pub async fn reject_track(
    State(state): State<Arc<AppState>>,
    Path(track_id): Path<Uuid>,
) -> Result<Json<TrackSubmissionResponse>, ApiError> {
    let query = r#"
    UPDATE community_tracks
    SET status = 'rejected', rejected_at = NOW()
    WHERE track_id = $1 AND status = 'pending'
    RETURNING track_id
  "#;

    let result = sqlx::query_scalar::<_, Uuid>(query)
        .bind(track_id)
        .fetch_one(&state.pool)
        .await
        .map_err(|e| ApiError {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: format!("db error: {e}"),
        })?;

    metrics::counter!("drawrace_track_moderations_total", "action" => "reject").increment(1);

    Ok(Json(TrackSubmissionResponse {
        track_id: result.to_string(),
        status: "rejected".to_string(),
        message: "Track rejected".to_string(),
    }))
}

pub async fn get_published_tracks(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<serde_json::Value>>, ApiError> {
    let query = r#"
    SELECT track_id, player_uuid, track_data, created_at
    FROM community_tracks
    WHERE status = 'published'
    ORDER BY published_at DESC
    LIMIT 50
  "#;

    let tracks =
        sqlx::query_as::<_, (Uuid, Uuid, serde_json::Value, chrono::DateTime<chrono::Utc>)>(query)
            .fetch_all(&state.pool)
            .await
            .map_err(|e| ApiError {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                message: format!("db error: {e}"),
            })?
            .into_iter()
            .map(|(track_id, player_uuid, track_data, created_at)| {
                serde_json::json!({
                  "track_id": track_id.to_string(),
                  "player_uuid": player_uuid.to_string(),
                  "track_data": track_data,
                  "created_at": created_at.to_rfc3339(),
                })
            })
            .collect();

    Ok(Json(tracks))
}

pub async fn get_track(
    State(state): State<Arc<AppState>>,
    Path(track_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let query = r#"
    SELECT track_data, status, player_uuid
    FROM community_tracks
    WHERE track_id = $1
  "#;

    let result: Option<(serde_json::Value, String, Uuid)> = sqlx::query_as(query)
        .bind(track_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| ApiError {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: format!("db error: {e}"),
        })?;

    match result {
        Some((track_data, status, player_uuid)) => Ok(Json(serde_json::json!({
          "track_id": track_id.to_string(),
          "status": status,
          "player_uuid": player_uuid.to_string(),
          "track_data": track_data,
        }))),
        None => Err(ApiError {
            status: StatusCode::NOT_FOUND,
            message: "Track not found".into(),
        }),
    }
}
