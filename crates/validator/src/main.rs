use anyhow::Context;
use aws_config::BehaviorVersion;
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

    let database_url = std::env::var("DATABASE_URL")
        .context("DATABASE_URL must be set")?;
    let redis_url = std::env::var("REDIS_URL")
        .context("REDIS_URL must be set")?;
    let s3_bucket = std::env::var("S3_BUCKET")
        .unwrap_or_else(|_| "drawrace-ghosts".to_string());

    // Postgres connection
    let pool = PgPool::connect(&database_url)
        .await
        .context("Failed to connect to Postgres")?;

    // Redis connection
    let redis_config = deadpool_redis::Config::from_url(redis_url);
    let redis = redis_config
        .create_pool(Some(deadpool_redis::Runtime::Tokio1))
        .context("Failed to create Redis pool")?;

    // S3 client
    let s3_config = aws_config::defaults(BehaviorVersion::latest());
    let s3 = aws_sdk_s3::Client::new(&s3_config.load().await);

    let state = Arc::new(ValidatorState {
        pool,
        s3,
        s3_bucket,
        redis,
    });

    // Start health check server
    let health_state = state.clone();
    tokio::spawn(async move {
        health_server(health_state).await;
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

async fn health_server(state: Arc<ValidatorState>) {
    let app = axum::Router::new()
        .route("/healthz", axum::routing::get(healthz_handler))
        .route("/internal/version", axum::routing::get(version_handler))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8081")
        .await
        .unwrap();

    tracing::info!("Health server listening on :8081");
    axum::serve(listener, app).await.unwrap();
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

async fn process_one_submission(
    state: &ValidatorState,
) -> anyhow::Result<Option<Uuid>> {
    // BRPOP with 5 second timeout
    let mut conn = state.redis.get().await?;
    let (_queue_name, submission_id_str): (String, String) = redis::cmd("BRPOP")
        .arg("drawrace:validate")
        .arg(5i64)
        .query_async(&mut *conn)
        .await?;

    let submission_id = Uuid::parse_str(&submission_id_str)
        .context("Invalid submission ID in queue")?;

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
    update_submission_verdict(
        &state.pool,
        submission_id,
        &verdict,
        &s3_key,
    ).await?;

    Ok(Some(submission_id))
}

async fn download_ghost_blob(
    state: &ValidatorState,
    s3_key: &str,
) -> anyhow::Result<Vec<u8>> {
    let resp = state.s3
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
    let header = BlobHeader::parse(blob)
        .context("Failed to parse blob header")?;

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
    let ghost = GhostBlob::parse(blob)
        .context("Failed to parse ghost blob")?;

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
            let ghost_id = verdict.ghost_id.context("Missing ghost_id for accepted verdict")?;
            let time_ms = verdict.time_ms.context("Missing time_ms for accepted verdict")?;

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
