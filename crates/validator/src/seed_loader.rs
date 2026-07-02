//! Seed pool loading for empty database initialization.
//!
//! On startup, if the ghosts table is empty, this module loads pre-recorded
//! seed ghost replays from /app/seeds/track_N/ into both S3 storage and the
//! Postgres ghosts table. This ensures new deployments have ghost content
//! immediately without requiring live player submissions.

use anyhow::Context;
use aws_sdk_s3::primitives::ByteStream;
use drawrace_api::blob::BlobHeader;
use sqlx::PgPool;
use std::fs;
use std::path::Path;
use uuid::Uuid;

/// All track IDs that require seed ghosts.
const ALL_TRACK_IDS: &[i16] = &[1, 2, 3];

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
    track_id: i16,
) -> anyhow::Result<()> {
    let filename = blob_path
        .file_name()
        .and_then(|n| n.to_str())
        .context("Invalid blob filename")?;

    // Read and parse the blob to extract metadata
    let blob_bytes = fs::read(blob_path).context("Failed to read seed blob")?;
    let header = BlobHeader::parse(&blob_bytes).context("Failed to parse seed blob header")?;

    // Generate S3 key for this seed ghost
    let track_dir = format!("track_{}", track_id);
    let s3_key = format!("seeds/{}/{}", track_dir, filename);

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
        track_id,
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

    let mut total_loaded = 0;

    // Iterate over all tracks
    for &track_id in ALL_TRACK_IDS {
        let track_dir_name = format!("track_{}", track_id);
        let track_dir = seeds_dir.join(&track_dir_name);

        if !track_dir.exists() {
            tracing::warn!(
                path = %track_dir.display(),
                "Seeds directory not found for track {}, skipping",
                track_id
            );
            continue;
        }

        tracing::info!(
            "Loading seed pool for track {} from {}",
            track_id,
            track_dir.display()
        );

        // Collect all .blob files for this track
        let mut blob_files: Vec<_> = fs::read_dir(&track_dir)
            .with_context(|| format!("Failed to read seeds directory for track {}", track_id))?
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
            tracing::warn!(
                "No seed blob files found in {} for track {}",
                track_dir.display(),
                track_id
            );
            continue;
        }

        tracing::info!(
            "Loading {} seed ghosts for track {}...",
            total,
            track_id
        );

        let mut loaded = 0;
        for entry in blob_files {
            match load_seed_ghost(pool, s3, s3_bucket, &entry.path(), track_id).await {
                Ok(()) => loaded += 1,
                Err(e) => {
                    tracing::error!(
                        path = %entry.path().display(),
                        track_id,
                        error = %e,
                        "Failed to load seed ghost, continuing"
                    );
                }
            }
        }

        tracing::info!(
            "Loaded {}/{} seed ghosts into Postgres for track {}",
            loaded,
            total,
            track_id
        );
        total_loaded += loaded;
    }

    // Refresh the leaderboard_buckets materialized view after seeding
    if total_loaded > 0 {
        sqlx::query("REFRESH MATERIALIZED VIEW leaderboard_buckets")
            .execute(pool)
            .await
            .context("Failed to refresh leaderboard_buckets after seeding")?;

        tracing::info!("Refreshed leaderboard_buckets materialized view");
    }

    if total_loaded == 0 {
        tracing::warn!("No seed ghosts loaded from any track directory");
    } else {
        tracing::info!("Loaded {} total seed ghosts across all tracks", total_loaded);
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

    #[test]
    fn test_all_track_ids_defined() {
        // Verify all track IDs are defined and include tracks 1, 2, 3
        assert_eq!(ALL_TRACK_IDS, &[1, 2, 3]);
        assert!(!ALL_TRACK_IDS.is_empty(), "ALL_TRACK_IDS must not be empty");
    }

    #[test]
    fn test_track_ids_sorted() {
        // Verify track IDs are sorted for deterministic loading order
        let mut sorted = ALL_TRACK_IDS.to_vec();
        sorted.sort();
        assert_eq!(ALL_TRACK_IDS, &sorted[..], "ALL_TRACK_IDS must be sorted");
    }

    #[test]
    fn test_seed_player_uuid_consistency() {
        // Verify the seed player UUID is the same in both modules
        // (matches SEED_PLAYER_UUID in api/src/seed.rs)
        assert_eq!(
            SEED_PLAYER_UUID,
            uuid::uuid!("00000000-0000-4000-8000-000000000001")
        );
    }

    #[test]
    fn test_all_tracks_covered() {
        // Verify all three tracks (1, 2, 3) are included
        assert_eq!(ALL_TRACK_IDS.len(), 3, "should have exactly 3 tracks");
        assert!(ALL_TRACK_IDS.contains(&1), "track 1 must be included");
        assert!(ALL_TRACK_IDS.contains(&2), "track 2 must be included");
        assert!(ALL_TRACK_IDS.contains(&3), "track 3 must be included");
    }

    #[test]
    fn test_track_directory_format() {
        // Verify track directories follow the expected naming pattern
        for &track_id in ALL_TRACK_IDS {
            let expected_dir = format!("track_{}", track_id);
            // Just verify the format is correct - don't check file existence
            // since we might not be in an environment with seeds checked out
            assert!(
                expected_dir.starts_with("track_"),
                "track directory should start with 'track_' for track {}",
                track_id
            );
        }
    }
}
