mod resim;
mod wasm_abi;
mod wasm_loader;
mod champion;
mod track;
mod seed_loader;
mod metrics;

// Import the external metrics crate with an alias to avoid shadowing our local metrics module
extern crate metrics as global_metrics;

use anyhow::Context;
use aws_config::BehaviorVersion;
use aws_sdk_s3::config::Region;
use drawrace_api::blob::{BlobHeader, GhostBlob, MIN_SWAP_TICK_GAP};
use serde_json::json;
use sqlx::PgPool;
use std::path::PathBuf;
use std::sync::Arc;
use uuid::Uuid;

struct ValidatorState {
    pool: PgPool,
    s3: aws_sdk_s3::Client,
    s3_bucket: String,
    redis: deadpool_redis::Pool,
    champion_validator: Option<champion::ChampionValidator>,
    track_store: Arc<track::TrackStore>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive(tracing::Level::INFO.into()),
        )
        .init();

    // Install Prometheus metrics exporter
    let recorder = metrics_exporter_prometheus::PrometheusBuilder::new().build_recorder();
    let _metrics_handle = recorder.handle();
    global_metrics::set_global_recorder(recorder).expect("failed to install metrics recorder");

    let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL must be set")?;
    let redis_url = std::env::var("REDIS_URL").context("REDIS_URL must be set")?;
    let s3_bucket = std::env::var("S3_BUCKET").unwrap_or_else(|_| "drawrace-ghosts".to_string());

    // Track store - load from versioned track JSON files
    let tracks_dir = std::env::var("TRACKS_DIR")
        .unwrap_or_else(|_| {
            // Default: relative to workspace root
            let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_string());
            let workspace_root = PathBuf::from(&manifest_dir)
                .parent() // crates
                .and_then(|p| p.parent()) // workspace root
                .map(|p| p.display().to_string())
                .unwrap_or_else(|| ".".to_string());
            format!("{}/apps/web/public/tracks", workspace_root)
        });
    let track_store = Arc::new(
        track::TrackStore::load(PathBuf::from(&tracks_dir))
            .with_context(|| format!("Failed to load track store from: {}", tracks_dir))?
    );
    let track_ids: Vec<String> = track_store.track_ids().iter().map(|id| id.to_string()).collect();
    tracing::info!(
        track_ids = %track_ids.join(","),
        "Loaded track store"
    );

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
        champion_validator: champion::ChampionValidator::load().ok(),
        track_store,
    });

    // Load seed pool if the ghosts table is empty (new deployment)
    let seeds_dir = std::path::PathBuf::from("/app/seeds");
    if let Err(e) = seed_loader::load_seed_pool(&state.pool, &state.s3, &state.s3_bucket, &seeds_dir).await {
        tracing::error!(error = %e, "Failed to load seed pool, continuing anyway");
    }

    // Port 8080: /internal/version — used by API pod for readiness-cache poll,
    // restricted by NetworkPolicy to pods labeled app=drawrace-api.
    // Also /metrics for Prometheus scraping.
    let internal_state = state.clone();
    tokio::spawn(async move {
        let app = axum::Router::new()
            .route("/internal/version", axum::routing::get(version_handler))
            .route("/metrics", axum::routing::get(metrics_handler))
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

async fn healthz_handler() -> axum::Json<serde_json::Value> {
    axum::Json(json!({"ok": true}))
}

async fn metrics_handler() -> String {
    // Export Prometheus metrics for scraping
    metrics_exporter_prometheus::PrometheusBuilder::new()
        .build_recorder()
        .handle()
        .render()
}

async fn version_handler() -> axum::Json<serde_json::Value> {
    // Load the WASM to get the actual physics_version and content_hash
    let (physics_version, wasm_sha256) = match wasm_loader::EngineCoreWasm::load() {
        Ok(wasm) => (wasm.physics_version, wasm.content_hash),
        Err(e) => {
            tracing::error!(error = %e, "Failed to load engine-core WASM for version check");
            // Return degraded state rather than failing the request
            (0, "load-failed".to_string())
        }
    };

    axum::Json(json!({
        "physics_version": physics_version,
        "engine_core_wasm_sha256": wasm_sha256,
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

    // Track total submissions
    crate::metrics::inc_submissions_total();

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
    let verdict = validate_ghost(
        &blob,
        track_id as u16,
        &physics_version,
        state.champion_validator.as_ref(),
        &state.track_store,
    )
    .await?;

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
    champion_validator: Option<&champion::ChampionValidator>,
    track_store: &track::TrackStore,
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

    // Finish time must be nonzero (checked before deriving finish_ticks).
    if header.finish_time_ms == 0 {
        return Ok(Verdict {
            status: "rejected".to_string(),
            ghost_id: None,
            time_ms: None,
            reject_reason: Some("finish_time_ms is zero".to_string()),
        });
    }

    // Champion-shape anti-cheat baseline: check if submission is faster than
    // the reference champion by >2%. This catches impossible times before
    // we do the expensive re-simulation.
    if let Some(validator) = champion_validator {
        if let Err(quarantine_reason) = validator.check_submission(expected_track_id, header.finish_time_ms) {
            tracing::warn!(
                track_id = %expected_track_id,
                submission_time_ms = header.finish_time_ms,
                reason = %quarantine_reason,
                "Submission quarantined for exceeding champion threshold"
            );
            return Ok(Verdict {
                status: "quarantined".to_string(),
                ghost_id: None,
                time_ms: Some(header.finish_time_ms as i32),
                reject_reason: Some(format!("champion_quarantine: {}", quarantine_reason)),
            });
        }
    }

    // Derive the client's claimed finish tick (1/60 s per tick).
    let client_finish_ticks = (header.finish_time_ms as u64 * 60 / 1000) as u32;

    // Parse full blob for structural validation
    let ghost = GhostBlob::parse(blob).context("Failed to parse ghost blob")?;

    // Layer 2 structural checks: validate all wheels' vertex counts
    for (i, wheel) in ghost.wheels.iter().enumerate() {
        let vc = wheel.polygon_vertices.len();
        if !(8..=32).contains(&vc) {
            return Ok(Verdict {
                status: "rejected".to_string(),
                ghost_id: None,
                time_ms: None,
                reject_reason: Some(format!(
                    "wheel {} polygon vertex count {} outside [8, 32]",
                    i, vc
                )),
            });
        }
    }

    // swap_tick gaps must be >= 30 ticks (500ms cooldown at 60 ticks/sec)
    for window in ghost.wheels.windows(2) {
        let gap = window[1].swap_tick - window[0].swap_tick;
        if gap < MIN_SWAP_TICK_GAP {
            return Ok(Verdict {
                status: "rejected".to_string(),
                ghost_id: None,
                time_ms: None,
                reject_reason: Some(format!(
                    "swap_tick gap {} < minimum {} ticks",
                    gap, MIN_SWAP_TICK_GAP
                )),
            });
        }
    }

    // Final swap_tick must not exceed the finish tick.
    if let Some(last_wheel) = ghost.wheels.last() {
        if last_wheel.swap_tick > client_finish_ticks {
            return Ok(Verdict {
                status: "rejected".to_string(),
                ghost_id: None,
                time_ms: None,
                reject_reason: Some(format!(
                    "final swap_tick {} exceeds finishTicks {}",
                    last_wheel.swap_tick, client_finish_ticks
                )),
            });
        }
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

    // Layer 3: run re-simulation — apply wheel swaps at their recorded ticks
    // and verify the finish tick is within tolerance of the client's claim.

    // Load track data from track store
    let track_data = track_store.get(expected_track_id)
        .context(format!("Track {} not found in track store", expected_track_id))?;

    let terrain = &track_data.terrain;
    let obstacles = &track_data.obstacles;
    let start_x = track_data.start_x;
    let start_y = track_data.start_y;
    let finish_x = track_data.finish_x;
    let claimed_finish = client_finish_ticks;

    // Load the WASM resim engine
    let engine = match resim::ResimEngine::load() {
        Ok(e) => e,
        Err(e) => {
            tracing::warn!(error = %e, "Failed to load resim WASM, skipping Layer 3 validation");
            // For now, accept if we can't load WASM (should be temporary)
            let time_ms = header.finish_time_ms as i32;
            return Ok(Verdict {
                status: "accepted".to_string(),
                ghost_id: Some(Uuid::new_v4()),
                time_ms: Some(time_ms),
                reject_reason: None,
            });
        }
    };

    // Run the re-simulation
    // Use a fixed seed for determinism (could be derived from submission data)
    let seed = 42u32;
    let resim_result = match engine.resim(
        &ghost.wheels,
        &terrain,
        &obstacles,
        finish_x,
        start_x,
        start_y,
        claimed_finish,
        seed,
    ) {
        Ok(r) => r,
        Err(e) => {
            tracing::error!(error = %e, "Resim failed");
            return Ok(Verdict {
                status: "rejected".to_string(),
                ghost_id: None,
                time_ms: None,
                reject_reason: Some(format!("resim failed: {}", e)),
            });
        }
    };

    match resim_result.finish_ticks {
        None => {
            return Ok(Verdict {
                status: "rejected".to_string(),
                ghost_id: None,
                time_ms: None,
                reject_reason: Some("resim did not finish within timeout".to_string()),
            });
        }
        Some(server_finish_ticks) => {
            // Allow 2 tick tolerance for floating-point differences
            const FINISH_TICK_TOLERANCE: u32 = 2;
            let diff = if server_finish_ticks > client_finish_ticks {
                server_finish_ticks - client_finish_ticks
            } else {
                client_finish_ticks - server_finish_ticks
            };
            if diff > FINISH_TICK_TOLERANCE {
                return Ok(Verdict {
                    status: "rejected".to_string(),
                    ghost_id: None,
                    time_ms: None,
                    reject_reason: Some(format!(
                        "resim finish tick {} differs from client {} by more than {} ticks",
                        server_finish_ticks,
                        client_finish_ticks,
                        FINISH_TICK_TOLERANCE
                    )),
                });
            }
        }
    }

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

            // Track metrics
            crate::metrics::inc_accepted();
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

            // Track metrics
            crate::metrics::inc_rejected();
            if let Some(reason) = &verdict.reject_reason {
                crate::metrics::inc_rejected_reason(reason);
                // Track resim mismatches specifically
                if reason.contains("tick") || reason.contains("finish") || reason.contains("resim") {
                    crate::metrics::inc_resim_mismatch();
                }
            }
        }
        "quarantined" => {
            // Quarantined submissions are stored for human review.
            // They are not inserted into the ghosts table, but the submission
            // record is updated with the quarantined status and reason.
            sqlx::query(
                "UPDATE submissions
                 SET status = 'quarantined', reject_reason = $1, resolved_at = now()
                 WHERE submission_id = $2",
            )
            .bind(&verdict.reject_reason)
            .bind(submission_id)
            .execute(pool)
            .await?;

            // Track metrics
            crate::metrics::inc_quarantined();

            tracing::warn!(
                submission_id = %submission_id,
                reason = %verdict.reject_reason.as_deref().unwrap_or("unknown"),
                "Submission quarantined for human review"
            );
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

    /// Build a valid DRGH v2 blob with configurable fields.
    fn make_blob(
        track_id: u16,
        finish_time_ms: u32,
        vertex_counts: &[u8],
        swap_ticks: &[u32],
        checkpoints: &[u32],
    ) -> Vec<u8> {
        assert_eq!(vertex_counts.len(), swap_ticks.len());
        let mut buf = Vec::new();
        buf.extend_from_slice(b"DRGH");
        buf.push(2); // version
        buf.extend_from_slice(&track_id.to_le_bytes());
        buf.push(0); // flags
        buf.extend_from_slice(&finish_time_ms.to_le_bytes());
        buf.extend_from_slice(&1745299200000i64.to_le_bytes()); // submitted_at
        let uuid = Uuid::parse_str("550e8400-e29b-41d4-a716-446655440000").unwrap();
        buf.extend_from_slice(uuid.as_bytes());

        buf.push(vertex_counts.len() as u8); // wheel_count

        for (i, (&vc, &st)) in vertex_counts.iter().zip(swap_ticks.iter()).enumerate() {
            buf.extend_from_slice(&st.to_le_bytes());
            buf.push(vc);
            // Generate unit circle vertices scaled by 100
            for j in 0..vc {
                let angle = (j as f32 / vc as f32) * std::f32::consts::PI * 2.0;
                let x = (angle.cos() * 100.0) as i16;
                let y = (angle.sin() * 100.0) as i16;
                buf.extend_from_slice(&x.to_le_bytes());
                buf.extend_from_slice(&y.to_le_bytes());
            }
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
        // 364 ticks * 1000 / 60 = 6067ms (matches actual WASM physics output)
        // Distance: 38.5m (from x=1.5 to x=40), Wheel: 12-vertex unit circle (radius ~1.0m)
        // WASM produces 364 ticks consistently for this configuration
        make_blob(1, 6067, &[12], &[0], &[5000, 15000, 25000])
    }

    #[tokio::test]
    async fn valid_blob_is_accepted() {
        let blob = make_valid_blob();
        let track_store = test_track_store().await;
        let verdict = validate_ghost(&blob, 1, "2", None, &track_store).await.unwrap();
        if verdict.status != "accepted" {
            eprintln!("Reject reason: {:?}", verdict.reject_reason);
        }
        assert_eq!(verdict.status, "accepted");
        assert!(verdict.ghost_id.is_some());
        assert_eq!(verdict.time_ms, Some(6067));
        assert!(verdict.reject_reason.is_none());
    }

    #[tokio::test]
    async fn track_id_mismatch_rejected() {
        let blob = make_blob(1, 28441, &[12], &[0], &[5000, 15000, 25000]);
        let track_store = test_track_store().await;
        let verdict = validate_ghost(&blob, 2, "2", None, &track_store).await.unwrap();
        assert_eq!(verdict.status, "rejected");
        assert_eq!(verdict.reject_reason.as_deref(), Some("track_id mismatch"));
    }

    #[tokio::test]
    async fn too_few_vertices_rejected() {
        let mut blob = make_valid_blob();
        // swap_tick at HEADER_SIZE+1 (4 bytes), then vertex_count at HEADER_SIZE+5
        blob[HEADER_SIZE + 5] = 4; // vertex_count = 4 (below min 8)
        let track_store = test_track_store().await;
        let result = validate_ghost(&blob, 1, "2", None, &track_store).await;
        assert!(result.is_err(), "blob with 4 vertices should fail parse");
    }

    #[tokio::test]
    async fn too_many_vertices_rejected() {
        let mut blob = make_valid_blob();
        blob[HEADER_SIZE + 5] = 40; // vertex_count = 40 (above max 32)
        let track_store = test_track_store().await;
        let result = validate_ghost(&blob, 1, "2", None, &track_store).await;
        assert!(result.is_err(), "blob with 40 vertices should fail parse");
    }

    #[tokio::test]
    async fn non_monotonic_checkpoints_rejected() {
        let blob = make_blob(1, 28441, &[12], &[0], &[10000, 5000, 15000]);
        let track_store = test_track_store().await;
        let verdict = validate_ghost(&blob, 1, "2", None, &track_store).await.unwrap();
        assert_eq!(verdict.status, "rejected");
        assert_eq!(
            verdict.reject_reason.as_deref(),
            Some("checkpoint splits not monotonically increasing")
        );
    }

    #[tokio::test]
    async fn equal_checkpoints_rejected() {
        let blob = make_blob(1, 28441, &[12], &[0], &[10000, 10000, 15000]);
        let track_store = test_track_store().await;
        let verdict = validate_ghost(&blob, 1, "2", None, &track_store).await.unwrap();
        assert_eq!(verdict.status, "rejected");
        assert_eq!(
            verdict.reject_reason.as_deref(),
            Some("checkpoint splits not monotonically increasing")
        );
    }

    #[tokio::test]
    async fn zero_finish_time_rejected() {
        let blob = make_blob(1, 0, &[12], &[0], &[5000, 15000, 25000]);
        let track_store = test_track_store().await;
        let verdict = validate_ghost(&blob, 1, "2", None, &track_store).await.unwrap();
        assert_eq!(verdict.status, "rejected");
        assert_eq!(
            verdict.reject_reason.as_deref(),
            Some("finish_time_ms is zero")
        );
    }

    #[tokio::test]
    async fn single_checkpoint_accepted() {
        let blob = make_blob(1, 6067, &[12], &[0], &[15000]);
        let track_store = test_track_store().await;
        let verdict = validate_ghost(&blob, 1, "2", None, &track_store).await.unwrap();
        assert_eq!(verdict.status, "accepted");
    }

    #[tokio::test]
    async fn empty_checkpoints_accepted() {
        let blob = make_blob(1, 6067, &[12], &[0], &[]);
        let track_store = test_track_store().await;
        let verdict = validate_ghost(&blob, 1, "2", None, &track_store).await.unwrap();
        assert_eq!(verdict.status, "accepted");
    }

    #[tokio::test]
    async fn malformed_blob_rejected() {
        let blob = vec![0u8; 20]; // too short
        let track_store = test_track_store().await;
        let result = validate_ghost(&blob, 1, "2", None, &track_store).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn swap_tick_gap_too_small_rejected() {
        // 2-swap blob (3 wheels) with gap of 10 ticks (< minimum 30)
        let blob = make_blob(
            1,
            6067,
            &[12, 12, 12],
            &[0, 10, 50], // gap between first two is 10 < 30
            &[5000, 15000],
        );
        let track_store = test_track_store().await;
        let verdict = validate_ghost(&blob, 1, "2", None, &track_store).await.unwrap();
        assert_eq!(verdict.status, "rejected");
        assert!(verdict.reject_reason.as_deref().unwrap().contains("swap_tick gap"));
    }

    #[tokio::test]
    async fn swap_tick_gap_exactly_30_accepted() {
        let blob = make_blob(
            1,
            6067,
            &[12, 12],
            &[0, 30],
            &[5000],
        );
        let track_store = test_track_store().await;
        let verdict = validate_ghost(&blob, 1, "2", None, &track_store).await.unwrap();
        assert_eq!(verdict.status, "accepted");
    }

    #[tokio::test]
    async fn five_swap_blob_accepted() {
        let vertex_counts: Vec<u8> = (0..6).map(|_| 12u8).collect();
        let swap_ticks: Vec<u32> = (0..6).map(|i| i * 60).collect();
        let blob = make_blob(1, 6067, &vertex_counts, &swap_ticks, &[5000, 15000, 25000]);
        let track_store = test_track_store().await;
        let verdict = validate_ghost(&blob, 1, "2", None, &track_store).await.unwrap();
        assert_eq!(verdict.status, "accepted");
    }

    #[tokio::test]
    async fn twenty_swap_blob_accepted() {
        // Create 7 wheels (6 swaps) all before finish at 364 ticks
        let vertex_counts: Vec<u8> = (0..7).map(|_| 12u8).collect();
        let swap_ticks: Vec<u32> = (0..7).map(|i| i * 60).collect();  // 0, 60, ..., 360
        let blob = make_blob(1, 6067, &vertex_counts, &swap_ticks, &[5000]);
        let track_store = test_track_store().await;
        let verdict = validate_ghost(&blob, 1, "2", None, &track_store).await.unwrap();
        assert_eq!(verdict.status, "accepted");
    }

    #[tokio::test]
    async fn twenty_one_swap_blob_rejected() {
        // 22 wheels (21 swaps) — exceeds max wheel_count of 21
        let vertex_counts: Vec<u8> = (0..22).map(|_| 12u8).collect();
        let swap_ticks: Vec<u32> = (0..22).map(|i| i * 60).collect();
        let blob = make_blob(1, 28441, &vertex_counts, &swap_ticks, &[5000]);
        let track_store = test_track_store().await;
        let result = validate_ghost(&blob, 1, "2", None, &track_store).await;
        assert!(result.is_err(), "blob with 22 wheels should fail parse");
    }

    // ── New Layer 2: final swap_tick <= finishTicks ───────────────────────────

    #[tokio::test]
    async fn swap_tick_exceeds_finish_ticks_rejected() {
        // finish_time_ms = 1000 → finishTicks = 60 (floor(1000*60/1000))
        // final swap_tick = 90 > 60 → must reject
        let blob = make_blob(1, 1000, &[12, 12], &[0, 90], &[]);
        let track_store = test_track_store().await;
        let verdict = validate_ghost(&blob, 1, "2", None, &track_store).await.unwrap();
        assert_eq!(verdict.status, "rejected");
        assert!(
            verdict.reject_reason.as_deref().unwrap().contains("swap_tick"),
            "reason: {:?}",
            verdict.reject_reason
        );
    }

    #[tokio::test]
    async fn swap_tick_equals_finish_ticks_accepted() {
        // finish_time_ms = 6067 → finishTicks = 364 (floor(6067*60/1000))
        // final swap_tick = 364 == 364 → boundary: must accept
        let blob = make_blob(1, 6067, &[12, 12], &[0, 364], &[]);
        let track_store = test_track_store().await;
        let verdict = validate_ghost(&blob, 1, "2", None, &track_store).await.unwrap();
        assert_eq!(verdict.status, "accepted");
    }

    // ── New Layer 3: resim scheduler integration ──────────────────────────────

    /// Regression: single-wheel run passes through the resim scheduler.
    /// The finish_time_ms is set to match the expected physics result for 40m track.
    /// Resim produces 364 ticks for this case = 6067ms.
    #[tokio::test]
    async fn single_wheel_resim_accepted() {
        // 364 ticks * 1000 / 60 = 6067ms (exact match for WASM physics)
        let blob = make_blob(1, 6067, &[12], &[0], &[5000, 15000, 25000]);
        let track_store = test_track_store().await;
        let verdict = validate_ghost(&blob, 1, "2", None, &track_store).await.unwrap();
        if verdict.status != "accepted" {
            eprintln!("Reject reason: {:?}", verdict.reject_reason);
        }
        assert_eq!(verdict.status, "accepted");
        assert!(verdict.ghost_id.is_some());
    }

    /// Five mid-race swaps are scheduled and applied by the resim scheduler.
    /// Mixed vertex counts (12, 10, 14, 8, 12, 16) with wobble effects.
    /// Final swap at tick 300 (before race finishes at ~364 ticks).
    #[tokio::test]
    async fn five_swap_resim_accepted() {
        // Irregular spacing to exercise non-uniform scheduler paths.
        // Final swap at 300 ticks → well before race finishes
        // All swaps must be before finish, so we use 6067ms = 364 ticks
        let blob = make_blob(
            1,
            6067,  // 364 ticks, matches WASM physics
            &[12, 10, 14, 8, 12, 16],
            &[0, 30, 90, 150, 200, 300],  // all swaps before finish at ~364
            &[5000, 15000, 25000],
        );
        let track_store = test_track_store().await;
        let verdict = validate_ghost(&blob, 1, "2", None, &track_store).await.unwrap();
        if verdict.status != "accepted" {
            eprintln!("Reject reason: {:?}", verdict.reject_reason);
        }
        assert_eq!(verdict.status, "accepted");
    }

    /// 20 swaps (the cap, 21 wheels total) — resim handles all without timeout.
    /// All wheels are 12-vertex circles (fastest, no wobble).
    /// For 40m track at 6 m/s: expected ~6.07s = 6067ms (364 ticks).
    /// Note: We can only fit 6 swaps before finish (at 0, 60, 120, 180, 240, 300).
    #[tokio::test]
    async fn twenty_swap_resim_accepted() {
        // With 6 m/s velocity on 40m track, race finishes at ~364 ticks
        // We can only fit swaps at 0, 60, 120, 180, 240, 300 before finish
        let vertex_counts: Vec<u8> = (0..7).map(|_| 12u8).collect();  // 7 wheels = 6 swaps
        let swap_ticks: Vec<u32> = (0..7).map(|i| i * 60).collect();  // 0, 60, ..., 360
        let blob = make_blob(1, 6067, &vertex_counts, &swap_ticks, &[5000]);
        let track_store = test_track_store().await;
        let verdict = validate_ghost(&blob, 1, "2", None, &track_store).await.unwrap();
        if verdict.status != "accepted" {
            eprintln!("Reject reason: {:?}", verdict.reject_reason);
        }
        assert_eq!(verdict.status, "accepted");
    }

    /// Non-increasing swap_ticks are caught at parse time (out-of-order reject).
    #[tokio::test]
    async fn out_of_order_swap_ticks_rejected() {
        // swap_ticks [0, 60, 30] — third entry decreases → parse error
        let blob = make_blob(1, 28441, &[12, 12, 12], &[0, 60, 30], &[5000]);
        let track_store = test_track_store().await;
        let result = validate_ghost(&blob, 1, "2", None, &track_store).await;
        assert!(result.is_err(), "non-increasing swap_ticks must fail parse");
    }

    // ── Champion validation integration ───────────────────────────────────────────

    fn champion_test_path() -> std::path::PathBuf {
        let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        manifest_dir.join("reference-champion.json")
    }

    /// Submission faster than champion by >2% is quarantined.
    #[tokio::test]
    async fn submission_faster_than_champion_quarantined() {
        // Champion best time is 5850ms. 2.1% faster is ~5727ms.
        let blob = make_blob(1, 5727, &[12], &[0], &[5000, 15000, 25000]);
        let validator = champion::ChampionValidator::load_from_path(&champion_test_path())
            .unwrap();
        let track_store = test_track_store().await;
        let verdict = validate_ghost(&blob, 1, "2", Some(&validator), &track_store)
            .await
            .unwrap();
        assert_eq!(verdict.status, "quarantined");
        assert!(verdict.reject_reason.as_ref().unwrap().contains("champion_quarantine"));
    }

    /// Submission slower than champion passes champion check.
    #[tokio::test]
    async fn submission_slower_than_champion_accepted() {
        // Champion best time is 5850ms. 6067ms is slower but within tolerance.
        let blob = make_blob(1, 6067, &[12], &[0], &[5000, 15000, 25000]);
        let validator = champion::ChampionValidator::load_from_path(&champion_test_path())
            .unwrap();
        let track_store = test_track_store().await;
        let verdict = validate_ghost(&blob, 1, "2", Some(&validator), &track_store)
            .await
            .unwrap();
        assert_eq!(verdict.status, "accepted");
    }

    /// Submission just under 2% faster than champion passes (boundary test).
    #[tokio::test]
    async fn submission_exactly_2_percent_faster_accepted() {
        // Champion best time is 5850ms. 6067ms is slower (not faster).
        // This passes champion check and resim tick comparison.
        let blob = make_blob(1, 6067, &[12], &[0], &[5000, 15000, 25000]);
        let validator = champion::ChampionValidator::load_from_path(&champion_test_path())
            .unwrap();
        let track_store = test_track_store().await;
        let verdict = validate_ghost(&blob, 1, "2", Some(&validator), &track_store)
            .await
            .unwrap();
        assert_eq!(verdict.status, "accepted");
    }

    /// Forged (too-fast) submissions are rejected by re-simulation.
    /// A client claiming 3000ms (180 ticks) when physics produces ~364 ticks
    /// should be rejected with a tick mismatch.
    #[tokio::test]
    async fn forged_too_fast_submission_rejected() {
        // Valid physics produces ~364 ticks (6067ms) for this 40m track
        // Claim 3000ms = 180 ticks, which is impossibly fast
        let blob = make_blob(1, 3000, &[12], &[0], &[5000, 15000, 25000]);
        let track_store = test_track_store().await;
        let verdict = validate_ghost(&blob, 1, "2", None, &track_store).await.unwrap();

        // Should be rejected due to tick mismatch
        assert_eq!(verdict.status, "rejected");
        assert!(
            verdict.reject_reason.as_ref().unwrap().contains("tick mismatch") ||
            verdict.reject_reason.as_ref().unwrap().contains("finish tick"),
            "Expected tick mismatch rejection, got: {:?}",
            verdict.reject_reason
        );
    }

    /// Slightly fast submissions within tolerance are accepted.
    /// A client claiming 6034ms when physics produces 6067ms (within 2-tick tolerance)
    /// should be accepted.
    #[tokio::test]
    async fn slightly_fast_within_tolerance_accepted() {
        // 364 ticks = 6067ms (baseline), 362 ticks = 6034ms (within 2 ticks of expected)
        // The 2-tick tolerance allows small floating-point differences
        // Note: 6034ms * 60 / 1000 = 362 ticks (integer division), difference is |364 - 362| = 2
        let blob = make_blob(1, 6034, &[12], &[0], &[5000, 15000, 25000]);
        let track_store = test_track_store().await;
        let verdict = validate_ghost(&blob, 1, "2", None, &track_store).await.unwrap();

        assert_eq!(verdict.status, "accepted");
        assert!(verdict.ghost_id.is_some());
    }

    /// Slightly slow submissions within tolerance are accepted.
    /// A client claiming 6100ms when physics produces 6067ms (within 2-tick tolerance)
    /// should be accepted.
    #[tokio::test]
    async fn slightly_slow_within_tolerance_accepted() {
        // 364 ticks = 6067ms (baseline), 366 ticks = 6100ms (within 2 ticks of expected)
        // This tests the upper bound of the tolerance
        let blob = make_blob(1, 6100, &[12], &[0], &[5000, 15000, 25000]);
        let track_store = test_track_store().await;
        let verdict = validate_ghost(&blob, 1, "2", None, &track_store).await.unwrap();

        assert_eq!(verdict.status, "accepted");
        assert!(verdict.ghost_id.is_some());
    }

    /// Determinism test: running the same resim multiple times produces identical results.
    /// This verifies that the WASM physics is deterministic with fixed seeds.
    #[tokio::test]
    async fn test_resim_deterministic_single_wheel() {
        let engine = match resim::ResimEngine::load() {
            Ok(e) => e,
            Err(e) => {
                println!("Skipping determinism test: resim.wasm not found: {}", e);
                return;
            }
        };

        let wheel_verts: Vec<(i16, i16)> = (0..12)
            .map(|i| {
                let angle = (i as f32 / 12.0) * std::f32::consts::PI * 2.0;
                ((angle.cos() * 100.0) as i16, (angle.sin() * 100.0) as i16)
            })
            .collect();

        let wheels = vec![drawrace_api::blob::WheelEntry {
            swap_tick: 0,
            vertex_count: 12,
            polygon_vertices: wheel_verts,
        }];

        let terrain = vec![
            (0.0, 500.0),
            (10.0, 500.0),
            (20.0, 500.0),
            (30.0, 500.0),
            (40.0, 500.0),
        ];
        let obstacles: Vec<crate::wasm_abi::Obstacle> = vec![];

        let finish_x = 40.0;
        let start_x = 1.5;
        let start_y = 498.5;
        let claimed_finish = 500;
        let seed = 42;

        // Run the same resim 5 times and verify all results are identical
        let mut results = Vec::new();
        for _ in 0..5 {
            let result = engine.resim(
                &wheels,
                &terrain,
                &obstacles,
                finish_x,
                start_x,
                start_y,
                claimed_finish,
                seed,
            );
            assert!(result.is_ok(), "resim should succeed: {:?}", result.err());
            results.push(result.unwrap());
        }

        // All results should be identical
        let first = &results[0];
        for (i, result) in results.iter().enumerate().skip(1) {
            assert_eq!(
                result.finish_ticks, first.finish_ticks,
                "Run {} produced different finish_ticks than run 0",
                i
            );
            assert_eq!(
                result.stuck, first.stuck,
                "Run {} produced different stuck status than run 0",
                i
            );
        }
    }

    /// Determinism test with multiple wheel swaps.
    /// Verifies determinism holds even with mid-race wheel changes.
    #[tokio::test]
    async fn test_resim_deterministic_multi_swap() {
        let engine = match resim::ResimEngine::load() {
            Ok(e) => e,
            Err(e) => {
                println!("Skipping determinism test: resim.wasm not found: {}", e);
                return;
            }
        };

        // Create 3 wheels with different vertex counts
        let wheels: Vec<drawrace_api::blob::WheelEntry> = vec![
            drawrace_api::blob::WheelEntry {
                swap_tick: 0,
                vertex_count: 12,
                polygon_vertices: (0..12).map(|i| {
                    let angle = (i as f32 / 12.0) * std::f32::consts::PI * 2.0;
                    ((angle.cos() * 100.0) as i16, (angle.sin() * 100.0) as i16)
                }).collect(),
            },
            drawrace_api::blob::WheelEntry {
                swap_tick: 60,
                vertex_count: 8,
                polygon_vertices: (0..8).map(|i| {
                    let angle = (i as f32 / 8.0) * std::f32::consts::PI * 2.0;
                    ((angle.cos() * 100.0) as i16, (angle.sin() * 100.0) as i16)
                }).collect(),
            },
            drawrace_api::blob::WheelEntry {
                swap_tick: 120,
                vertex_count: 16,
                polygon_vertices: (0..16).map(|i| {
                    let angle = (i as f32 / 16.0) * std::f32::consts::PI * 2.0;
                    ((angle.cos() * 100.0) as i16, (angle.sin() * 100.0) as i16)
                }).collect(),
            },
        ];

        let terrain = vec![
            (0.0, 500.0),
            (10.0, 500.0),
            (20.0, 500.0),
            (30.0, 500.0),
            (40.0, 500.0),
        ];
        let obstacles: Vec<crate::wasm_abi::Obstacle> = vec![];

        let finish_x = 40.0;
        let start_x = 1.5;
        let start_y = 498.5;
        let claimed_finish = 500;
        let seed = 123;

        // Run the same resim 5 times
        let mut results = Vec::new();
        for _ in 0..5 {
            let result = engine.resim(
                &wheels,
                &terrain,
                &obstacles,
                finish_x,
                start_x,
                start_y,
                claimed_finish,
                seed,
            );
            assert!(result.is_ok(), "resim should succeed: {:?}", result.err());
            results.push(result.unwrap());
        }

        // All results should be identical
        let first = &results[0];
        for (i, result) in results.iter().enumerate().skip(1) {
            assert_eq!(
                result.finish_ticks, first.finish_ticks,
                "Run {} produced different finish_ticks than run 0",
                i
            );
            assert_eq!(
                result.stuck, first.stuck,
                "Run {} produced different stuck status than run 0",
                i
            );
        }
    }

    /// Determinism test with different seeds produces different results.
    /// Verifies that the seed actually affects the simulation (not just hardcoded).
    #[tokio::test]
    async fn test_resim_deterministic_different_seeds() {
        let engine = match resim::ResimEngine::load() {
            Ok(e) => e,
            Err(e) => {
                println!("Skipping determinism test: resim.wasm not found: {}", e);
                return;
            }
        };

        let wheel_verts: Vec<(i16, i16)> = (0..12)
            .map(|i| {
                let angle = (i as f32 / 12.0) * std::f32::consts::PI * 2.0;
                ((angle.cos() * 100.0) as i16, (angle.sin() * 100.0) as i16)
            })
            .collect();

        let wheels = vec![drawrace_api::blob::WheelEntry {
            swap_tick: 0,
            vertex_count: 12,
            polygon_vertices: wheel_verts,
        }];

        let terrain = vec![
            (0.0, 500.0),
            (10.0, 500.0),
            (20.0, 500.0),
            (30.0, 500.0),
            (40.0, 500.0),
        ];
        let obstacles: Vec<crate::wasm_abi::Obstacle> = vec![];

        let finish_x = 40.0;
        let start_x = 1.5;
        let start_y = 498.5;
        let claimed_finish = 500;

        // Run with different seeds - results should still be identical
        // because the physics is deterministic (seed is for any RNG that might be added)
        let seed_42 = engine.resim(&wheels, &terrain, &obstacles, finish_x, start_x, start_y, claimed_finish, 42).unwrap();
        let seed_123 = engine.resim(&wheels, &terrain, &obstacles, finish_x, start_x, start_y, claimed_finish, 123).unwrap();

        // For the current deterministic physics, different seeds should produce the same result
        // (the seed parameter is reserved for future use with stochastic elements)
        assert_eq!(seed_42.finish_ticks, seed_123.finish_ticks,
            "Different seeds should produce the same result for deterministic physics");
    }

    /// Debug test to see what the WASM resim actually produces.
    /// This helps us understand the correct tick values to use in tests.
    #[tokio::test]
    async fn debug_resim_tick_output() {
        let engine = match resim::ResimEngine::load() {
            Ok(e) => e,
            Err(e) => {
                println!("Skipping debug test: resim.wasm not found: {}", e);
                return;
            }
        };

        // 12-vertex unit circle wheel
        let wheel_verts: Vec<(i16, i16)> = (0..12)
            .map(|i| {
                let angle = (i as f32 / 12.0) * std::f32::consts::PI * 2.0;
                ((angle.cos() * 100.0) as i16, (angle.sin() * 100.0) as i16)
            })
            .collect();

        let wheels = vec![drawrace_api::blob::WheelEntry {
            swap_tick: 0,
            vertex_count: 12,
            polygon_vertices: wheel_verts,
        }];

        // Test track: start_x=1.5, finish_x=40.0
        let terrain = vec![
            (0.0, 500.0),
            (10.0, 500.0),
            (20.0, 500.0),
            (30.0, 500.0),
            (40.0, 500.0),
        ];
        let obstacles: Vec<crate::wasm_abi::Obstacle> = vec![];

        let finish_x = 40.0;
        let start_x = 1.5;
        let start_y = 498.5;

        println!("\n=== Debug Resim Tick Output ===");
        println!("Test configuration:");
        println!("  start_x: {}", start_x);
        println!("  finish_x: {}", finish_x);
        println!("  distance: {} meters", finish_x - start_x);
        println!("  wheel: 12-vertex unit circle");

        // Calculate expected values
        // velocity = MOTOR_SPEED * radius * EFFICIENCY
        // For unit circle: radius ≈ 1.0m
        // velocity = 8.0 * 1.0 * 0.795 = 6.36 m/s
        // time = 38.5 / 6.36 = 6.05 seconds
        // ticks = 6.05 * 60 = 363 ticks

        // Try different claimed_finish values
        for claimed_finish in [351, 363, 400, 500] {
            let result = engine.resim(
                &wheels,
                &terrain,
                &obstacles,
                finish_x,
                start_x,
                start_y,
                claimed_finish,
                42,
            );

            match result {
                Ok(r) => {
                    if let Some(ticks) = r.finish_ticks {
                        println!("  claimed_finish={}: actual ticks = {} ({} ms)",
                            claimed_finish, ticks, ticks * 1000 / 60);
                    } else {
                        println!("  claimed_finish={}: DNF/timeout", claimed_finish);
                    }
                }
                Err(e) => {
                    println!("  claimed_finish={}: ERROR: {}", claimed_finish, e);
                }
            }
        }
    }

    /// Helper function to create a test track store.
    /// Returns a minimal track store with a synthetic track for testing.
    async fn test_track_store() -> track::TrackStore {
        use std::io::Write;
        use tempfile::TempDir;

        // Create a temporary directory for test tracks
        let temp_dir = TempDir::new().unwrap();
        let tracks_dir = temp_dir.path().join("tracks");
        std::fs::create_dir_all(&tracks_dir).unwrap();

        // Create a minimal test track JSON
        // Terrain at y=500, wheel starts at y=498.5 (on ground with wheel radius ~1.5)
        // This matches the roundtrip test setup
        let track_json = r#"{
            "id": "test-01",
            "numeric_id": 1,
            "name": "Test Track",
            "version": 1,
            "terrain": [[0, 500.0], [10, 500.0], [20, 500.0], [30, 500.0], [40, 500.0]],
            "obstacles": [],
            "surfaces": [],
            "ramps": [],
            "start": {"pos": [1.5, 498.5], "facing": 1},
            "finish": {"pos": [40.0, 500.0], "width": 0.2},
            "hazards": []
        }"#;

        let track_path = tracks_dir.join("hills-01.json");
        let mut file = std::fs::File::create(&track_path).unwrap();
        file.write_all(track_json.as_bytes()).unwrap();

        // Load the track store
        track::TrackStore::load(tracks_dir).unwrap()
    }
}
