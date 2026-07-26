use axum::body::Bytes;
use axum::extract::{ConnectInfo, Query, State};
use axum::http::StatusCode;
use axum::response::{AppendHeaders, IntoResponse, Json};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
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

#[derive(Debug, Deserialize)]
pub struct DailyChallengeQuery {
    pub daily_challenge_date: Option<String>, // ISO 8601 date
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

/// Per-player-UUID submission *write* rate limit. Mirrors the
/// `rl:name:{uuid}` INCR + EXPIRE pattern in `handlers::names::post_name`,
/// but under a `rl:submit:` namespace: 20 persisted submissions per 60s
/// window. The 21st submission in the window is rejected with 429 +
/// `Retry-After`.
pub const SUBMIT_RATE_LIMIT_MAX: i64 = 20;
pub const SUBMIT_RATE_LIMIT_WINDOW_SECS: i64 = 60;

/// Per-source-IP submission *write* rate limit, sharing the window above.
///
/// The `api.*` vhost is an unauthenticated public write endpoint with **no
/// trusted proxy** in front of it (plan §Multiplayer & Backend 1 — DNS-only /
/// orange-cloud-off): the only thing identifying a flooding client is the TCP
/// peer address. The per-UUID limit above caps each *identity*, but a single
/// attacker can mint unlimited throwaway UUIDs — 1000 fresh UUIDs × 20
/// writes = 20,000 writes/min from one host, all under the per-UUID ceiling.
/// The per-IP counter caps that aggregate, so the two limits compose: the
/// per-UUID one bounds a real player's writes, the per-IP one bounds a single
/// source's writes regardless of how many UUIDs it hides behind.
///
/// 200/min/IP is a generous ceiling for any single real device (a player
/// submits well under 1/min) while keeping a flood/spam script far below the
/// rate that would strain Postgres, S3, or the validator queue. In staging the
/// k6 load-tester's egress is allowlisted via `DRAWRACE_RATE_LIMIT_BYPASS_CIDR`
/// (plan §Multiplayer & Backend 8 Layer 2); that bypass never runs in
/// production.
pub const SUBMIT_RATE_LIMIT_PER_IP_MAX: i64 = 200;

/// Seconds to tell a rate-limited client to wait before retrying. Uses the
/// counter key's remaining TTL when available; falls back to the full window
/// when the TTL is missing or non-positive (key absent, no expiry set, or the
/// TTL lookup itself errored).
fn retry_after_seconds(ttl_seconds: i64, window_seconds: i64) -> i64 {
    if ttl_seconds > 0 {
        ttl_seconds
    } else {
        window_seconds
    }
}

/// Build the 429 Too Many Requests response carrying a `Retry-After` header
/// (a non-negative integer of seconds, per RFC 7231). Extracted so the
/// response shape is unit-testable without Redis.
fn rate_limited_response(retry_after_secs: i64) -> axum::response::Response {
    (
        StatusCode::TOO_MANY_REQUESTS,
        AppendHeaders([(
            axum::http::header::RETRY_AFTER,
            retry_after_secs.to_string(),
        )]),
        Json(serde_json::json!({ "error": "rate limit exceeded" })),
    )
        .into_response()
}

pub async fn post_submission(
    State(state): State<Arc<AppState>>,
    Query(daily_query): Query<DailyChallengeQuery>,
    connect_info: ConnectInfo<SocketAddr>,
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

    // Physics version check: reject submissions from stale clients
    let validator = state.validator_cache.read().await;
    if header.version as u16 != validator.physics_version {
        return Ok((
            StatusCode::CONFLICT,
            Json(serde_json::json!({
                "error": "PHYSICS_VERSION_MISMATCH",
                "expected": validator.physics_version
            })),
        )
            .into_response());
    }
    drop(validator);

    {
        let hmac_cfg = state.hmac_config.read().await;
        if !hmac_cfg.verify(&body, &client_hmac) {
            return Err(ApiError {
                status: StatusCode::BAD_REQUEST,
                message: "HMAC verification failed".into(),
            });
        }
    }

    // Ephemeral flag (bit 0x02): validate structurally but skip persistence
    const EPHEMERAL_FLAG: u8 = 0x02;
    if header.flags & EPHEMERAL_FLAG != 0 {
        // Structural validation — parse the full blob to ensure it's well-formed
        crate::blob::GhostBlob::parse(&body).map_err(|e| ApiError {
            status: StatusCode::BAD_REQUEST,
            message: format!("invalid blob: {e}"),
        })?;

        metrics::counter!("drawrace_submissions_total", "outcome" => "ephemeral").increment(1);

        return Ok(StatusCode::NO_CONTENT.into_response());
    }

    // Per-player-UUID AND per-source-IP *write* rate limits. Whichever trips
    // first returns 429 + Retry-After (see [`rate_limited_response`]).
    //
    // Runs after the cheap request validation (header/blob/HMAC/physics-version
    // checks above, which reject malformed or forged requests with 400/409
    // without any I/O) and before the first DB write, so that (a) rejected
    // requests don't burn a rate budget, and (b) ephemeral non-persisting
    // submissions (handled above) are exempt — these limit writes, not
    // validation. This mirrors `handlers::names::post_name`'s INCR + EXPIRE
    // block.
    {
        let mut conn = state.redis.get().await.map_err(|e| {
            tracing::error!(error = %e, "Redis pool get failed");
            ApiError {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                message: "rate limit error".into(),
            }
        })?;

        // Per-UUID: at most SUBMIT_RATE_LIMIT_MAX persisted submissions per
        // window, keyed on the authenticated player UUID.
        let uuid_key = format!("rl:submit:{}", player_uuid);
        let uuid_count: i64 = redis::cmd("INCR")
            .arg(&uuid_key)
            .query_async(&mut conn)
            .await
            .unwrap_or(0);

        if uuid_count == 1 {
            let _: () = redis::cmd("EXPIRE")
                .arg(&uuid_key)
                .arg(SUBMIT_RATE_LIMIT_WINDOW_SECS)
                .query_async(&mut conn)
                .await
                .unwrap_or(());
        }

        if uuid_count > SUBMIT_RATE_LIMIT_MAX {
            // Tell the client how long until the window resets. The key's TTL
            // is the precise remaining time; fall back to the full window if
            // the TTL is unavailable.
            let ttl: i64 = redis::cmd("TTL")
                .arg(&uuid_key)
                .query_async(&mut conn)
                .await
                .unwrap_or(-1);
            let retry_after = retry_after_seconds(ttl, SUBMIT_RATE_LIMIT_WINDOW_SECS);
            metrics::counter!("drawrace_submissions_total", "outcome" => "rate_limited")
                .increment(1);
            return Ok(rate_limited_response(retry_after));
        }

        // Per-IP: at most SUBMIT_RATE_LIMIT_PER_IP_MAX persisted submissions
        // per window from one TCP peer address. The key is the real TCP peer
        // (`crate::ip::peer_ip`) — NEVER X-Forwarded-For / X-Real-IP /
        // CF-Connecting-IP, which are attacker-controlled on this vhost (plan
        // §Multiplayer & Backend 1). This bounds the aggregate write rate from
        // a single host hiding behind many throwaway UUIDs.
        let peer = crate::ip::peer_ip(connect_info);
        let ip_key = format!("rl:submit:ip:{}", peer);
        let ip_count: i64 = redis::cmd("INCR")
            .arg(&ip_key)
            .query_async(&mut conn)
            .await
            .unwrap_or(0);

        if ip_count == 1 {
            let _: () = redis::cmd("EXPIRE")
                .arg(&ip_key)
                .arg(SUBMIT_RATE_LIMIT_WINDOW_SECS)
                .query_async(&mut conn)
                .await
                .unwrap_or(());
        }

        if ip_count > SUBMIT_RATE_LIMIT_PER_IP_MAX {
            let ttl: i64 = redis::cmd("TTL")
                .arg(&ip_key)
                .query_async(&mut conn)
                .await
                .unwrap_or(-1);
            let retry_after = retry_after_seconds(ttl, SUBMIT_RATE_LIMIT_WINDOW_SECS);
            metrics::counter!("drawrace_submissions_total", "outcome" => "rate_limited")
                .increment(1);
            return Ok(rate_limited_response(retry_after));
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

    // Validate daily_challenge_date if provided
    let daily_challenge_date = if let Some(date_str) = daily_query.daily_challenge_date {
        // Verify the challenge exists
        let exists: Option<(i16,)> =
            sqlx::query_as("SELECT track_id FROM daily_challenges WHERE challenge_date = $1")
                .bind(&date_str)
                .fetch_optional(&state.pool)
                .await
                .map_err(|e| ApiError {
                    status: StatusCode::INTERNAL_SERVER_ERROR,
                    message: format!("db error: {e}"),
                })?;

        if exists.is_none() {
            return Err(ApiError {
                status: StatusCode::BAD_REQUEST,
                message: "No daily challenge found for this date".into(),
            });
        }
        Some(date_str)
    } else {
        None
    };

    sqlx::query(
        "INSERT INTO submissions (submission_id, player_uuid, track_id, physics_version, status, s3_key, daily_challenge_date)
         VALUES ($1, $2, $3, $4, 'pending_validation', $5, $6)",
    )
    .bind(submission_id)
    .bind(player_uuid)
    .bind(track_id as i16)
    .bind(header.version as i16)
    .bind(&s3_key)
    .bind(&daily_challenge_date)
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

    metrics::counter!("drawrace_submissions_total", "outcome" => "accepted").increment(1);
    metrics::gauge!("drawrace_ghost_blob_bytes").set(body.len() as f64);

    Ok((
        StatusCode::ACCEPTED,
        Json(SubmissionAccepted {
            submission_id: submission_id.to_string(),
            status: "pending_validation",
            poll_url,
        }),
    )
        .into_response())
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

                let is_pb: bool =
                    sqlx::query_scalar("SELECT is_pb FROM ghosts WHERE ghost_id = $1")
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

    #[test]
    fn submit_rate_limit_constants_match_spec() {
        assert_eq!(SUBMIT_RATE_LIMIT_MAX, 20);
        assert_eq!(SUBMIT_RATE_LIMIT_WINDOW_SECS, 60);
    }

    #[test]
    fn per_ip_rate_limit_constant_matches_spec() {
        // 200/min/IP — generous for a real device, a hard cap on a flood from
        // one host. See the constant's doc comment for the rationale.
        assert_eq!(SUBMIT_RATE_LIMIT_PER_IP_MAX, 200);
        // The per-IP ceiling must be strictly looser than the per-UUID one —
        // otherwise it could never be the binding limit and would be dead code.
        // Enforced at compile time: the values are `const`, so a future tweak
        // that inverts the relationship fails the build rather than a test run.
        const {
            assert!(SUBMIT_RATE_LIMIT_PER_IP_MAX > SUBMIT_RATE_LIMIT_MAX);
        }
    }

    #[test]
    fn retry_after_seconds_uses_ttl_when_positive() {
        assert_eq!(retry_after_seconds(45, 60), 45);
        assert_eq!(retry_after_seconds(1, 60), 1);
    }

    #[test]
    fn retry_after_seconds_falls_back_to_window_when_ttl_non_positive() {
        // 0 = key just expired, -1 = no expiry set, -2 = key does not exist
        assert_eq!(retry_after_seconds(0, 60), 60);
        assert_eq!(retry_after_seconds(-1, 60), 60);
        assert_eq!(retry_after_seconds(-2, 60), 60);
    }

    #[tokio::test]
    async fn rate_limited_response_carries_429_and_retry_after() {
        let resp = rate_limited_response(42);
        assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);

        let retry_after = resp
            .headers()
            .get("retry-after")
            .expect("429 must carry a Retry-After header");
        assert_eq!(retry_after.to_str().unwrap(), "42");

        // Body matches the ApiError error shape.
        let bytes = axum::body::to_bytes(resp.into_body(), 4096).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["error"], "rate limit exceeded");
    }

    #[tokio::test]
    async fn rate_limited_response_retry_after_at_full_window() {
        let resp = rate_limited_response(SUBMIT_RATE_LIMIT_WINDOW_SECS);
        assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(
            resp.headers().get("retry-after").unwrap().to_str().unwrap(),
            "60"
        );
    }
}
