use anyhow::Context;
use aws_config::BehaviorVersion;
use aws_sdk_s3::config::Region;
use drawrace_api::blob::{BlobHeader, GhostBlob};
use serde_json::json;
use sqlx::PgPool;
use std::sync::Arc;
use uuid::Uuid;

struct ValidatorState {
    pool: PgPool,
    s3: aws_sdk_s3::Client,
    s3_bucket: String,
    redis: deadpool_redis::Pool,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive(tracing::Level::INFO.into()),
        )
        .init();

    let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL must be set")?;
    let redis_url = std::env::var("REDIS_URL").context("REDIS_URL must be set")?;
    let s3_bucket = std::env::var("S3_BUCKET").unwrap_or_else(|_| "drawrace-ghosts".to_string());

    // Postgres connection
    let pool = PgPool::connect(&database_url)
        .await
        .context("Failed to connect to Postgres")?;

    // Redis connection
    let redis_config = deadpool_redis::Config::from_url(redis_url);
    let redis = redis_config
        .create_pool(Some(deadpool_redis::Runtime::Tokio1))
        .context("Failed to create Redis pool")?;

    // S3 client — support custom endpoint for Garage S3
    let region = std::env::var("S3_REGION").unwrap_or_else(|_| "garage".to_string());
    let mut s3_config_builder =
        aws_config::defaults(BehaviorVersion::latest()).region(Region::new(region));
    if let Ok(endpoint) = std::env::var("S3_ENDPOINT") {
        s3_config_builder = s3_config_builder.endpoint_url(endpoint);
    }
    let s3 = aws_sdk_s3::Client::new(&s3_config_builder.load().await);

    let state = Arc::new(ValidatorState {
        pool,
        s3,
        s3_bucket,
        redis,
    });

    // Port 8080: /internal/version — used by API pod for readiness-cache poll,
    // restricted by NetworkPolicy to pods labeled app=drawrace-api.
    let internal_state = state.clone();
    tokio::spawn(async move {
        let app = axum::Router::new()
            .route("/internal/version", axum::routing::get(version_handler))
            .with_state(internal_state);
        let listener = tokio::net::TcpListener::bind("0.0.0.0:8080")
            .await
            .expect("bind :8080");
        tracing::info!("Internal server listening on :8080");
        axum::serve(listener, app).await.expect("serve :8080");
    });

    // Port 8081: /healthz — kubelet readiness/liveness probe, unrestricted.
    let health_state = state.clone();
    tokio::spawn(async move {
        let app = axum::Router::new()
            .route("/healthz", axum::routing::get(healthz_handler))
            .with_state(health_state);
        let listener = tokio::net::TcpListener::bind("0.0.0.0:8081")
            .await
            .expect("bind :8081");
        tracing::info!("Health server listening on :8081");
        axum::serve(listener, app).await.expect("serve :8081");
    });

    tracing::info!("DrawRace validator starting");

    // Main validation loop
    loop {
        match process_one_submission(&state).await {
            Ok(Some(submission_id)) => {
                tracing::info!(submission_id = %submission_id, "Validated submission");
            }
            Ok(None) => {
                // Timeout is expected - just means queue was empty
            }
            Err(e) => {
                tracing::error!(error = %e, "Validation error");
            }
        }
    }
}

async fn healthz_handler() -> &'static str {
    "ok"
}

async fn version_handler() -> axum::Json<serde_json::Value> {
    axum::Json(json!({
        "physics_version": 1,
        "engine_core_wasm_sha256": "stub-will-be-replaced",
        "ok": true,
    }))
}

async fn process_one_submission(state: &ValidatorState) -> anyhow::Result<Option<Uuid>> {
    // BRPOP with 5 second timeout
    let mut conn = state.redis.get().await?;
    let (_queue_name, submission_id_str): (String, String) = redis::cmd("BRPOP")
        .arg("drawrace:validate")
        .arg(5i64)
        .query_async(&mut *conn)
        .await?;

    let submission_id =
        Uuid::parse_str(&submission_id_str).context("Invalid submission ID in queue")?;

    tracing::info!(submission_id = %submission_id, "Processing submission");

    // Fetch submission metadata from Postgres (including s3_key)
    let row: Option<(Uuid, i32, String, String)> = sqlx::query_as(
        "SELECT player_uuid, track_id, physics_version, s3_key
         FROM submissions WHERE submission_id = $1",
    )
    .bind(submission_id)
    .fetch_optional(&state.pool)
    .await
    .context("Failed to fetch submission")?;

    let Some((_player_uuid, track_id, physics_version, s3_key)) = row else {
        tracing::warn!(submission_id = %submission_id, "Submission not found, skipping");
        return Ok(None);
    };

    // Download ghost blob from S3 using the stored s3_key
    let blob = download_ghost_blob(state, &s3_key).await?;

    // Validate the blob
    let verdict = validate_ghost(&blob, track_id as u16, &physics_version).await?;

    // Update Postgres with verdict
    update_submission_verdict(&state.pool, submission_id, &verdict, &s3_key).await?;

    Ok(Some(submission_id))
}

async fn download_ghost_blob(state: &ValidatorState, s3_key: &str) -> anyhow::Result<Vec<u8>> {
    let resp = state
        .s3
        .get_object()
        .bucket(&state.s3_bucket)
        .key(s3_key)
        .send()
        .await
        .with_context(|| format!("S3 get failed for key: {}", s3_key))?;

    let blob = resp.body.collect().await?.into_bytes().to_vec();

    Ok(blob)
}

struct Verdict {
    status: String,
    ghost_id: Option<Uuid>,
    time_ms: Option<i32>,
    reject_reason: Option<String>,
}

async fn validate_ghost(
    blob: &[u8],
    expected_track_id: u16,
    _physics_version: &str,
) -> anyhow::Result<Verdict> {
    // Parse blob header
    let header = BlobHeader::parse(blob).context("Failed to parse blob header")?;

    // Basic validation
    if header.track_id != expected_track_id {
        return Ok(Verdict {
            status: "rejected".to_string(),
            ghost_id: None,
            time_ms: None,
            reject_reason: Some("track_id mismatch".to_string()),
        });
    }

    // Parse full blob for structural validation
    let ghost = GhostBlob::parse(blob).context("Failed to parse ghost blob")?;

    // Layer 2 structural checks
    if ghost.polygon_vertices.len() < 8 || ghost.polygon_vertices.len() > 32 {
        return Ok(Verdict {
            status: "rejected".to_string(),
            ghost_id: None,
            time_ms: None,
            reject_reason: Some(format!(
                "polygon vertex count {} outside [8, 32]",
                ghost.polygon_vertices.len()
            )),
        });
    }

    // Checkpoint splits must be monotonically increasing
    for window in ghost.checkpoint_splits.windows(2) {
        if window[0] >= window[1] {
            return Ok(Verdict {
                status: "rejected".to_string(),
                ghost_id: None,
                time_ms: None,
                reject_reason: Some("checkpoint splits not monotonically increasing".to_string()),
            });
        }
    }

    // Finish time must be nonzero
    if header.finish_time_ms == 0 {
        return Ok(Verdict {
            status: "rejected".to_string(),
            ghost_id: None,
            time_ms: None,
            reject_reason: Some("finish_time_ms is zero".to_string()),
        });
    }

    // Physics re-simulation (Layer 3) deferred until engine-core WASM is compiled.
    // Structural validation (Layer 2) covers blob format, vertex bounds, and
    // checkpoint monotonicity — sufficient to reject garbage submissions.

    let time_ms = header.finish_time_ms as i32;

    Ok(Verdict {
        status: "accepted".to_string(),
        ghost_id: Some(Uuid::new_v4()),
        time_ms: Some(time_ms),
        reject_reason: None,
    })
}

async fn update_submission_verdict(
    pool: &PgPool,
    submission_id: Uuid,
    verdict: &Verdict,
    s3_key: &str,
) -> anyhow::Result<()> {
    match verdict.status.as_str() {
        "accepted" => {
            let ghost_id = verdict
                .ghost_id
                .context("Missing ghost_id for accepted verdict")?;
            let time_ms = verdict
                .time_ms
                .context("Missing time_ms for accepted verdict")?;

            // Begin transaction
            let mut tx = pool.begin().await?;

            // Check if this is a PB for the player
            let is_pb: bool = sqlx::query_scalar(
                "SELECT COALESCE($2 < (
                    SELECT MIN(time_ms) FROM ghosts
                    WHERE player_uuid = (SELECT player_uuid FROM submissions WHERE submission_id = $1)
                      AND track_id = (SELECT track_id FROM submissions WHERE submission_id = $1)
                ), true)",
            )
            .bind(submission_id)
            .bind(time_ms)
            .fetch_one(&mut *tx)
            .await
            .unwrap_or(true);

            // Unflag previous PBs for this player/track before inserting new one
            if is_pb {
                sqlx::query(
                    "UPDATE ghosts SET is_pb = false
                     WHERE player_uuid = (SELECT player_uuid FROM submissions WHERE submission_id = $1)
                       AND track_id = (SELECT track_id FROM submissions WHERE submission_id = $1)
                       AND is_pb = true",
                )
                .bind(submission_id)
                .execute(&mut *tx)
                .await?;
            }

            // Insert ghost with actual s3_key from submission
            sqlx::query(
                "INSERT INTO ghosts (ghost_id, player_uuid, track_id, physics_version, time_ms, is_pb, s3_key)
                 SELECT $1, player_uuid, track_id, physics_version, $2, $3, $4
                 FROM submissions WHERE submission_id = $5",
            )
            .bind(ghost_id)
            .bind(time_ms)
            .bind(is_pb)
            .bind(s3_key)
            .bind(submission_id)
            .execute(&mut *tx)
            .await?;

            // Update submission status
            sqlx::query(
                "UPDATE submissions
                 SET status = 'accepted', ghost_id = $1, resolved_at = now()
                 WHERE submission_id = $2",
            )
            .bind(ghost_id)
            .bind(submission_id)
            .execute(&mut *tx)
            .await?;

            tx.commit().await?;
        }
        "rejected" => {
            sqlx::query(
                "UPDATE submissions
                 SET status = 'rejected', reject_reason = $1, resolved_at = now()
                 WHERE submission_id = $2",
            )
            .bind(&verdict.reject_reason)
            .bind(submission_id)
            .execute(pool)
            .await?;
        }
        _ => {
            anyhow::bail!("Unknown verdict status: {}", verdict.status);
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use drawrace_api::blob::HEADER_SIZE;

    /// Build a valid DRGH blob with configurable fields.
    fn make_blob(
        track_id: u16,
        finish_time_ms: u32,
        vertex_count: u8,
        checkpoints: &[u32],
    ) -> Vec<u8> {
        let vertex_count = vertex_count.clamp(8, 32);
        let mut buf = Vec::new();
        buf.extend_from_slice(b"DRGH");
        buf.push(1); // version
        buf.extend_from_slice(&track_id.to_le_bytes());
        buf.push(0); // flags
        buf.extend_from_slice(&finish_time_ms.to_le_bytes());
        buf.extend_from_slice(&1745299200000i64.to_le_bytes()); // submitted_at
        let uuid = Uuid::parse_str("550e8400-e29b-41d4-a716-446655440000").unwrap();
        buf.extend_from_slice(uuid.as_bytes());
        buf.push(vertex_count);
        for i in 0..vertex_count {
            buf.extend_from_slice(&((i as i16) * 10).to_le_bytes());
            buf.extend_from_slice(&((i as i16) * 20).to_le_bytes());
        }
        buf.push(5u8); // point_count
        for i in 0..5u8 {
            buf.extend_from_slice(&(i as i16).to_le_bytes());
            buf.extend_from_slice(&((i as i16) * 2).to_le_bytes());
            buf.extend_from_slice(&16u16.to_le_bytes());
        }
        buf.push(checkpoints.len() as u8);
        for &cp in checkpoints {
            buf.extend_from_slice(&cp.to_le_bytes());
        }
        buf
    }

    fn make_valid_blob() -> Vec<u8> {
        make_blob(1, 28441, 12, &[5000, 15000, 25000])
    }

    #[tokio::test]
    async fn valid_blob_is_accepted() {
        let blob = make_valid_blob();
        let verdict = validate_ghost(&blob, 1, "1").await.unwrap();
        assert_eq!(verdict.status, "accepted");
        assert!(verdict.ghost_id.is_some());
        assert_eq!(verdict.time_ms, Some(28441));
        assert!(verdict.reject_reason.is_none());
    }

    #[tokio::test]
    async fn track_id_mismatch_rejected() {
        let blob = make_blob(1, 28441, 12, &[5000, 15000, 25000]);
        let verdict = validate_ghost(&blob, 2, "1").await.unwrap();
        assert_eq!(verdict.status, "rejected");
        assert_eq!(verdict.reject_reason.as_deref(), Some("track_id mismatch"));
    }

    #[tokio::test]
    async fn too_few_vertices_rejected() {
        let mut blob = make_valid_blob();
        // Blob parser rejects vertex_count < 8 at parse time, so we can't
        // construct a blob with <8 vertices via GhostBlob::parse. The validator
        // layer-2 check is a defense-in-depth that runs after successful parse.
        // Test the parser rejection instead.
        blob[HEADER_SIZE] = 4; // vertex_count = 4 (below min 8)
        let result = validate_ghost(&blob, 1, "1").await;
        assert!(result.is_err(), "blob with 4 vertices should fail parse");
    }

    #[tokio::test]
    async fn too_many_vertices_rejected() {
        let mut blob = make_valid_blob();
        // Similarly, parser enforces max 32. Test the parser rejection.
        blob[HEADER_SIZE] = 40; // vertex_count = 40 (above max 32)
        let result = validate_ghost(&blob, 1, "1").await;
        assert!(result.is_err(), "blob with 40 vertices should fail parse");
    }

    #[tokio::test]
    async fn non_monotonic_checkpoints_rejected() {
        let blob = make_blob(1, 28441, 12, &[10000, 5000, 15000]);
        let verdict = validate_ghost(&blob, 1, "1").await.unwrap();
        assert_eq!(verdict.status, "rejected");
        assert_eq!(
            verdict.reject_reason.as_deref(),
            Some("checkpoint splits not monotonically increasing")
        );
    }

    #[tokio::test]
    async fn equal_checkpoints_rejected() {
        let blob = make_blob(1, 28441, 12, &[10000, 10000, 15000]);
        let verdict = validate_ghost(&blob, 1, "1").await.unwrap();
        assert_eq!(verdict.status, "rejected");
        assert_eq!(
            verdict.reject_reason.as_deref(),
            Some("checkpoint splits not monotonically increasing")
        );
    }

    #[tokio::test]
    async fn zero_finish_time_rejected() {
        let blob = make_blob(1, 0, 12, &[5000, 15000, 25000]);
        let verdict = validate_ghost(&blob, 1, "1").await.unwrap();
        assert_eq!(verdict.status, "rejected");
        assert_eq!(
            verdict.reject_reason.as_deref(),
            Some("finish_time_ms is zero")
        );
    }

    #[tokio::test]
    async fn single_checkpoint_accepted() {
        let blob = make_blob(1, 28441, 12, &[15000]);
        let verdict = validate_ghost(&blob, 1, "1").await.unwrap();
        assert_eq!(verdict.status, "accepted");
    }

    #[tokio::test]
    async fn empty_checkpoints_accepted() {
        let blob = make_blob(1, 28441, 12, &[]);
        let verdict = validate_ghost(&blob, 1, "1").await.unwrap();
        assert_eq!(verdict.status, "accepted");
    }

    #[tokio::test]
    async fn malformed_blob_rejected() {
        let blob = vec![0u8; 20]; // too short
        let result = validate_ghost(&blob, 1, "1").await;
        assert!(result.is_err());
    }
}
