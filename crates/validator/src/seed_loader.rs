//! Seed pool loading for empty database initialization.
//!
//! On startup, if the ghosts table is empty, this module loads pre-recorded
//! seed ghost replays from /app/seeds/track_1/ into both S3 storage and the
//! Postgres ghosts table. This ensures new deployments have ghost content
//! immediately without requiring live player submissions.

use anyhow::Context;
use aws_sdk_s3::primitives::ByteStream;
use drawrace_api::blob::BlobHeader;
use sqlx::PgPool;
use std::fs;
use std::path::Path;
use uuid::Uuid;

/// Seed player UUID - a special player that owns all seed ghosts.
/// This UUID is consistent across deployments so seed ghosts are
/// recognizable as non-player content.
const SEED_PLAYER_UUID: Uuid = uuid::uuid!("00000000-0000-4000-8000-000000000001");

/// Check if the ghosts table is empty and needs seeding.
async fn is_ghosts_table_empty(pool: &PgPool) -> anyhow::Result<bool> {
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM ghosts")
        .fetch_one(pool)
        .await
        .context("Failed to check ghosts table count")?;
    Ok(count == 0)
}

/// Load a single seed ghost blob file into S3 and Postgres.
async fn load_seed_ghost(
    pool: &PgPool,
    s3: &aws_sdk_s3::Client,
    s3_bucket: &str,
    blob_path: &Path,
) -> anyhow::Result<()> {
    let filename = blob_path
        .file_name()
        .and_then(|n| n.to_str())
        .context("Invalid blob filename")?;

    // Read and parse the blob to extract metadata
    let blob_bytes = fs::read(blob_path).context("Failed to read seed blob")?;
    let header = BlobHeader::parse(&blob_bytes).context("Failed to parse seed blob header")?;

    // Generate S3 key for this seed ghost
    let s3_key = format!("seeds/track_1/{}", filename);

    // Upload the blob to S3
    s3.put_object()
        .bucket(s3_bucket)
        .key(&s3_key)
        .body(ByteStream::from(blob_bytes.clone()))
        .send()
        .await
        .with_context(|| format!("Failed to upload seed blob to S3: {}", s3_key))?;

    // Insert the ghost record into Postgres
    let ghost_id = Uuid::new_v4();
    let track_id: i16 = header.track_id as i16;
    let physics_version: i16 = header.version as i16;
    let time_ms: i32 = header.finish_time_ms as i32;

    // Ensure the seed player exists
    sqlx::query(
        "INSERT INTO players (player_uuid) VALUES ($1) ON CONFLICT (player_uuid) DO NOTHING",
    )
    .bind(SEED_PLAYER_UUID)
    .execute(pool)
    .await?;

    // Insert the ghost record
    sqlx::query(
        "INSERT INTO ghosts (ghost_id, player_uuid, track_id, physics_version, time_ms, is_pb, is_legacy, s3_key)
         VALUES ($1, $2, $3, $4, $5, true, true, $6)",
    )
    .bind(ghost_id)
    .bind(SEED_PLAYER_UUID)
    .bind(track_id)
    .bind(physics_version)
    .bind(time_ms)
    .bind(&s3_key)
    .execute(pool)
    .await
    .context("Failed to insert seed ghost into Postgres")?;

    tracing::info!(
        filename,
        ghost_id = %ghost_id,
        time_ms,
        "Loaded seed ghost"
    );

    Ok(())
}

/// Load all seed ghosts from the seeds directory into S3 and Postgres.
pub async fn load_seed_pool(
    pool: &PgPool,
    s3: &aws_sdk_s3::Client,
    s3_bucket: &str,
    seeds_dir: &Path,
) -> anyhow::Result<()> {
    // Only load seeds if the ghosts table is completely empty
    if !is_ghosts_table_empty(pool).await? {
        tracing::info!("Ghosts table is not empty, skipping seed pool loading");
        return Ok(());
    }

    let track_1_dir = seeds_dir.join("track_1");
    if !track_1_dir.exists() {
        tracing::warn!(
            path = %track_1_dir.display(),
            "Seeds directory not found, skipping seed pool loading"
        );
        return Ok(());
    }

    tracing::info!(
        "Ghosts table is empty, loading seed pool from {}",
        track_1_dir.display()
    );

    // Collect all .blob files
    let mut blob_files: Vec<_> = fs::read_dir(&track_1_dir)
        .context("Failed to read seeds directory")?
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry
                .path()
                .extension()
                .map(|e| e == "blob")
                .unwrap_or(false)
        })
        .collect();

    // Sort by filename for deterministic loading order
    blob_files.sort_by_key(|entry| entry.file_name());

    let total = blob_files.len();
    if total == 0 {
        tracing::warn!("No seed blob files found in {}", track_1_dir.display());
        return Ok(());
    }

    tracing::info!("Loading {} seed ghosts...", total);

    let mut loaded = 0;
    for entry in blob_files {
        match load_seed_ghost(pool, s3, s3_bucket, &entry.path()).await {
            Ok(()) => loaded += 1,
            Err(e) => {
                tracing::error!(
                    path = %entry.path().display(),
                    error = %e,
                    "Failed to load seed ghost, continuing"
                );
            }
        }
    }

    tracing::info!("Loaded {}/{} seed ghosts into Postgres", loaded, total);

    // Refresh the leaderboard_buckets materialized view after seeding
    if loaded > 0 {
        sqlx::query("REFRESH MATERIALIZED VIEW leaderboard_buckets")
            .execute(pool)
            .await
            .context("Failed to refresh leaderboard_buckets after seeding")?;

        tracing::info!("Refreshed leaderboard_buckets materialized view");
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_seed_player_uuid() {
        // Verify the seed player UUID is consistent
        assert_eq!(
            SEED_PLAYER_UUID,
            uuid::uuid!("00000000-0000-4000-8000-000000000001")
        );
    }
}
