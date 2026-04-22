use axum::body::Bytes;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json};
use serde::Serialize;
use std::sync::Arc;
use uuid::Uuid;

use crate::blob::BlobHeader;
use crate::AppState;

#[derive(Debug, Serialize)]
pub struct SubmissionAccepted {
    pub submission_id: String,
    pub status: &'static str,
    pub poll_url: String,
}

#[derive(Debug, Serialize)]
pub struct SubmissionPending {
    pub status: &'static str,
}

#[derive(Debug, Serialize)]
pub struct SubmissionAcceptedVerdict {
    pub status: &'static str,
    pub ghost_id: String,
    pub time_ms: i32,
    pub rank: i64,
    pub bucket: String,
    pub is_pb: bool,
}

#[derive(Debug, Serialize)]
pub struct SubmissionRejectedVerdict {
    pub status: &'static str,
    pub reason: String,
}

#[derive(Debug)]
pub struct ApiError {
    pub status: StatusCode,
    pub message: String,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        (
            self.status,
            Json(serde_json::json!({ "error": self.message })),
        )
            .into_response()
    }
}

pub async fn post_submission(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
    body: Bytes,
) -> Result<impl IntoResponse, ApiError> {
    let player_uuid = extract_player_uuid(&headers)?;
    let track_id = extract_track_id(&headers)?;
    let client_hmac = extract_hmac(&headers)?;

    if body.len() < crate::blob::HEADER_SIZE {
        return Err(ApiError {
            status: StatusCode::BAD_REQUEST,
            message: "blob too short".into(),
        });
    }

    let header = BlobHeader::parse(&body).map_err(|e| ApiError {
        status: StatusCode::BAD_REQUEST,
        message: format!("invalid blob: {e}"),
    })?;

    if header.track_id != track_id {
        return Err(ApiError {
            status: StatusCode::BAD_REQUEST,
            message: "track_id header does not match blob".into(),
        });
    }

    if header.player_uuid != player_uuid {
        return Err(ApiError {
            status: StatusCode::BAD_REQUEST,
            message: "player_uuid header does not match blob".into(),
        });
    }

    {
        let hmac_cfg = state.hmac_config.read().await;
        if !hmac_cfg.verify(&body, &client_hmac) {
            return Err(ApiError {
                status: StatusCode::BAD_REQUEST,
                message: "HMAC verification failed".into(),
            });
        }
    }

    // Lazy player registration
    sqlx::query("INSERT INTO players (player_uuid) VALUES ($1) ON CONFLICT DO NOTHING")
        .bind(player_uuid)
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: format!("db error: {e}"),
        })?;

    let submission_id = Uuid::new_v4();
    let s3_key = format!("ghosts/{}/{}/{}.bin", track_id, player_uuid, submission_id);

    sqlx::query(
        "INSERT INTO submissions (submission_id, player_uuid, track_id, physics_version, status, s3_key)
         VALUES ($1, $2, $3, $4, 'pending_validation', $5)",
    )
    .bind(submission_id)
    .bind(player_uuid)
    .bind(track_id as i16)
    .bind(header.version as i16)
    .bind(&s3_key)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        message: format!("db error: {e}"),
    })?;

    state
        .s3
        .put_object()
        .bucket(&state.s3_bucket)
        .key(&s3_key)
        .body(body.to_vec().into())
        .send()
        .await
        .map_err(|e| {
            tracing::error!(s3_key = %s3_key, error = %e, "S3 put failed");
            ApiError {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                message: "storage error".into(),
            }
        })?;

    {
        let mut conn = state.redis.get().await.map_err(|e| {
            tracing::error!(error = %e, "Redis pool get failed");
            ApiError {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                message: "queue error".into(),
            }
        })?;
        let inflight_key = format!("submission:{}:inflight", submission_id);
        redis::cmd("SET")
            .arg(&inflight_key)
            .arg(player_uuid.to_string())
            .arg("EX")
            .arg(60i64)
            .exec_async(&mut conn)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, "Redis SET inflight failed");
                ApiError {
                    status: StatusCode::INTERNAL_SERVER_ERROR,
                    message: "queue error".into(),
                }
            })?;

        redis::cmd("LPUSH")
            .arg("drawrace:validate")
            .arg(submission_id.to_string())
            .exec_async(&mut conn)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, "Redis LPUSH failed");
                ApiError {
                    status: StatusCode::INTERNAL_SERVER_ERROR,
                    message: "queue error".into(),
                }
            })?;
    }

    let poll_url = format!("/v1/submissions/{}", submission_id);

    Ok((
        StatusCode::ACCEPTED,
        Json(SubmissionAccepted {
            submission_id: submission_id.to_string(),
            status: "pending_validation",
            poll_url,
        }),
    ))
}

pub async fn get_submission(
    State(state): State<Arc<AppState>>,
    axum::extract::Path(submission_id): axum::extract::Path<Uuid>,
    headers: axum::http::HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    let player_uuid = extract_player_uuid(&headers)?;

    // Check Postgres first — fetch status + owner in one query
    type SubRow = (Uuid, String, Option<Uuid>, Option<i32>, Option<String>);
    let row: Option<SubRow> = sqlx::query_as(
        "SELECT player_uuid, status, ghost_id, time_ms, reject_reason
         FROM submissions WHERE submission_id = $1",
    )
    .bind(submission_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        message: format!("db error: {e}"),
    })?;

    if let Some((owner_uuid, status, ghost_id, time_ms, reject_reason)) = row {
        // Enumeration-safe: mismatch → 404 (not 403)
        if owner_uuid != player_uuid {
            return Err(ApiError {
                status: StatusCode::NOT_FOUND,
                message: "not found".into(),
            });
        }

        return match status.as_str() {
            "accepted" => {
                let gid = ghost_id.unwrap();

                let (rank,): (i64,) = sqlx::query_as(
                    "SELECT COUNT(*) + 1 FROM ghosts g
                     JOIN submissions s ON s.track_id = g.track_id
                     WHERE s.submission_id = $1
                       AND g.time_ms < $2 AND g.is_pb = true",
                )
                .bind(submission_id)
                .bind(time_ms.unwrap_or(0))
                .fetch_one(&state.pool)
                .await
                .map_err(|e| ApiError {
                    status: StatusCode::INTERNAL_SERVER_ERROR,
                    message: format!("db error: {e}"),
                })?;

                let bucket = bucket_for_rank(rank);

                let is_pb: bool = sqlx::query_scalar(
                    "SELECT is_pb FROM ghosts WHERE ghost_id = $1",
                )
                .bind(gid)
                .fetch_one(&state.pool)
                .await
                .unwrap_or(false);

                Ok((
                    StatusCode::OK,
                    Json(SubmissionAcceptedVerdict {
                        status: "accepted",
                        ghost_id: gid.to_string(),
                        time_ms: time_ms.unwrap_or(0),
                        rank,
                        bucket,
                        is_pb,
                    }),
                )
                    .into_response())
            }
            "rejected" => Ok((
                StatusCode::OK,
                Json(SubmissionRejectedVerdict {
                    status: "rejected",
                    reason: reject_reason.unwrap_or_else(|| "unknown".into()),
                }),
            )
                .into_response()),
            _ => Ok((
                StatusCode::OK,
                Json(SubmissionPending {
                    status: "pending_validation",
                }),
            )
                .into_response()),
        };
    }

    // Postgres miss — check Redis inflight key
    {
        let mut conn = state.redis.get().await.map_err(|e| {
            tracing::error!(error = %e, "Redis pool get failed");
            ApiError {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                message: "queue error".into(),
            }
        })?;
        let inflight_key = format!("submission:{}:inflight", submission_id);
        let stored_uuid: Option<String> = redis::cmd("GET")
            .arg(&inflight_key)
            .query_async(&mut conn)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, "Redis GET inflight failed");
                ApiError {
                    status: StatusCode::INTERNAL_SERVER_ERROR,
                    message: "queue error".into(),
                }
            })?;

        match stored_uuid {
            Some(owner_str) if owner_str == player_uuid.to_string() => Ok((
                StatusCode::OK,
                Json(SubmissionPending {
                    status: "pending_validation",
                }),
            )
                .into_response()),
            // Owner mismatch or key absent → 404 (enumeration-safe)
            _ => Err(ApiError {
                status: StatusCode::NOT_FOUND,
                message: "not found".into(),
            }),
        }
    }
}

fn bucket_for_rank(rank: i64) -> String {
    if rank <= 1 {
        "elite".into()
    } else if rank <= 5 {
        "advanced".into()
    } else if rank <= 20 {
        "skilled".into()
    } else if rank <= 50 {
        "mid".into()
    } else {
        "novice".into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bucket_for_rank_boundaries() {
        assert_eq!(bucket_for_rank(1), "elite");
        assert_eq!(bucket_for_rank(2), "advanced");
        assert_eq!(bucket_for_rank(5), "advanced");
        assert_eq!(bucket_for_rank(6), "skilled");
        assert_eq!(bucket_for_rank(20), "skilled");
        assert_eq!(bucket_for_rank(21), "mid");
        assert_eq!(bucket_for_rank(50), "mid");
        assert_eq!(bucket_for_rank(51), "novice");
        assert_eq!(bucket_for_rank(1000), "novice");
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

fn extract_track_id(headers: &axum::http::HeaderMap) -> Result<u16, ApiError> {
    let val = headers
        .get("X-DrawRace-Track")
        .ok_or_else(|| ApiError {
            status: StatusCode::BAD_REQUEST,
            message: "missing X-DrawRace-Track header".into(),
        })?
        .to_str()
        .map_err(|_| ApiError {
            status: StatusCode::BAD_REQUEST,
            message: "invalid X-DrawRace-Track header".into(),
        })?;

    val.parse().map_err(|_| ApiError {
        status: StatusCode::BAD_REQUEST,
        message: "invalid track_id".into(),
    })
}

fn extract_hmac(headers: &axum::http::HeaderMap) -> Result<String, ApiError> {
    let val = headers
        .get("X-DrawRace-ClientHMAC")
        .ok_or_else(|| ApiError {
            status: StatusCode::BAD_REQUEST,
            message: "missing X-DrawRace-ClientHMAC header".into(),
        })?
        .to_str()
        .map_err(|_| ApiError {
            status: StatusCode::BAD_REQUEST,
            message: "invalid X-DrawRace-ClientHMAC header".into(),
        })?;

    Ok(val.to_string())
}
