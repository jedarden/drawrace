use aws_sdk_s3::Client as S3Client;
use sqlx::PgPool;
use uuid::Uuid;

const PHYSICS_VERSION: u8 = 1;
const TRACK_ID: i16 = 1;
const HEADER_SIZE: usize = 36;

/// Fixed UUID for the seed player — all seed ghosts belong to this identity.
pub const SEED_PLAYER_UUID: &str = "00000000-0000-4000-8000-000000000001";

struct SeedGhost {
    #[allow(dead_code)]
    name: &'static str,
    time_ms: u32,
    /// Polygon vertices as (x, y) in metres. Encoded as i16 hundredths.
    vertices: &'static [(f64, f64)],
}

/// 25 seed ghosts with varied wheel shapes and times spanning all 5 buckets.
///
/// Bucket distribution with 25 seeds (percent_rank over ordered times):
/// - elite    (pr ≤ 0.01):  1 ghost
/// - advanced (pr ≤ 0.05):  1 ghost
/// - skilled  (pr ≤ 0.20):  4 ghosts
/// - mid      (pr ≤ 0.50):  7 ghosts
/// - novice   (pr >  0.50): 12 ghosts
///
/// Times are ordered fastest to slowest so the percentile mapping is deterministic.
const SEEDS: &[SeedGhost] = &[
    // elite
    SeedGhost {
        name: "Blaze",
        time_ms: 25_400,
        vertices: &[
            (0.48, 0.0), (0.44, 0.19), (0.34, 0.34), (0.19, 0.44), (0.0, 0.48),
            (-0.19, 0.44), (-0.34, 0.34), (-0.44, 0.19), (-0.48, 0.0), (-0.44, -0.19),
            (-0.34, -0.34), (-0.19, -0.44), (0.0, -0.48), (0.19, -0.44), (0.34, -0.34),
            (0.44, -0.19),
        ],
    },
    // advanced
    SeedGhost {
        name: "Swift",
        time_ms: 29_800,
        vertices: &[
            (0.55, 0.0), (0.51, 0.21), (0.39, 0.39), (0.21, 0.51), (0.0, 0.55),
            (-0.21, 0.51), (-0.39, 0.39), (-0.51, 0.21), (-0.55, 0.0), (-0.51, -0.21),
            (-0.39, -0.39), (-0.21, -0.51), (0.0, -0.55), (0.21, -0.51), (0.39, -0.39),
            (0.51, -0.21),
        ],
    },
    // skilled
    SeedGhost {
        name: "Quick",
        time_ms: 32_100,
        vertices: &[
            (0.50, 0.0), (0.46, 0.19), (0.35, 0.35), (0.19, 0.46), (0.0, 0.50),
            (-0.19, 0.46), (-0.35, 0.35), (-0.46, 0.19), (-0.50, 0.0), (-0.46, -0.19),
            (-0.35, -0.35), (-0.19, -0.46), (0.0, -0.50), (0.19, -0.46),
        ],
    },
    SeedGhost {
        name: "Dash",
        time_ms: 33_500,
        vertices: &[
            (0.60, 0.0), (0.55, 0.25), (0.42, 0.42), (0.25, 0.55), (0.0, 0.60),
            (-0.25, 0.55), (-0.42, 0.42), (-0.55, 0.25), (-0.60, 0.0), (-0.55, -0.25),
            (-0.42, -0.42), (-0.25, -0.55), (0.0, -0.60), (0.25, -0.55), (0.42, -0.42),
            (0.55, -0.25),
        ],
    },
    SeedGhost {
        name: "Bolt",
        time_ms: 35_200,
        vertices: &[
            (0.65, 0.0), (0.55, 0.35), (0.30, 0.56), (0.0, 0.65), (-0.30, 0.56),
            (-0.55, 0.35), (-0.65, 0.0), (-0.55, -0.35), (-0.30, -0.56), (0.0, -0.65),
        ],
    },
    SeedGhost {
        name: "Sprint",
        time_ms: 37_800,
        vertices: &[
            (0.52, 0.0), (0.49, 0.15), (0.42, 0.30), (0.30, 0.42), (0.15, 0.49),
            (0.0, 0.52), (-0.15, 0.49), (-0.30, 0.42), (-0.42, 0.30), (-0.49, 0.15),
            (-0.52, 0.0), (-0.49, -0.15), (-0.42, -0.30), (-0.30, -0.42), (-0.15, -0.49),
            (0.0, -0.52), (0.15, -0.49), (0.30, -0.42),
        ],
    },
    // mid
    SeedGhost {
        name: "Pacer",
        time_ms: 40_100,
        vertices: &[
            (0.45, 0.0), (0.42, 0.17), (0.32, 0.32), (0.17, 0.42), (0.0, 0.45),
            (-0.17, 0.42), (-0.32, 0.32), (-0.42, 0.17), (-0.45, 0.0), (-0.42, -0.17),
            (-0.32, -0.32), (-0.17, -0.42), (0.0, -0.45), (0.17, -0.42), (0.32, -0.32),
            (0.42, -0.17),
        ],
    },
    SeedGhost {
        name: "Steady",
        time_ms: 42_600,
        vertices: &[
            (0.70, 0.0), (0.65, 0.27), (0.49, 0.49), (0.27, 0.65), (0.0, 0.70),
            (-0.27, 0.65), (-0.49, 0.49), (-0.65, 0.27), (-0.70, 0.0), (-0.65, -0.27),
            (-0.49, -0.49), (-0.27, -0.65), (0.0, -0.70), (0.27, -0.65), (0.49, -0.49),
            (0.65, -0.27),
        ],
    },
    SeedGhost {
        name: "Cruise",
        time_ms: 44_300,
        vertices: &[
            (0.55, 0.0), (0.48, 0.28), (0.28, 0.48), (0.0, 0.55), (-0.28, 0.48),
            (-0.48, 0.28), (-0.55, 0.0), (-0.48, -0.28), (-0.28, -0.48), (0.0, -0.55),
            (0.28, -0.48), (0.48, -0.28),
        ],
    },
    SeedGhost {
        name: "Ramble",
        time_ms: 46_900,
        vertices: &[
            (0.58, 0.0), (0.50, 0.30), (0.30, 0.50), (0.0, 0.58), (-0.30, 0.50),
            (-0.50, 0.30), (-0.58, 0.0), (-0.50, -0.30), (-0.30, -0.50), (0.0, -0.58),
            (0.30, -0.50), (0.50, -0.30),
        ],
    },
    SeedGhost {
        name: "Drift",
        time_ms: 49_200,
        vertices: &[
            (0.40, 0.0), (0.35, 0.20), (0.20, 0.35), (0.0, 0.40), (-0.20, 0.35),
            (-0.35, 0.20), (-0.40, 0.0), (-0.35, -0.20), (-0.20, -0.35), (0.0, -0.40),
            (0.20, -0.35), (0.35, -0.20),
        ],
    },
    SeedGhost {
        name: "Mosey",
        time_ms: 51_700,
        vertices: &[
            (0.62, 0.0), (0.57, 0.24), (0.44, 0.44), (0.24, 0.57), (0.0, 0.62),
            (-0.24, 0.57), (-0.44, 0.44), (-0.57, 0.24), (-0.62, 0.0), (-0.57, -0.24),
            (-0.44, -0.44), (-0.24, -0.57), (0.0, -0.62), (0.24, -0.57), (0.44, -0.44),
            (0.57, -0.24),
        ],
    },
    SeedGhost {
        name: "Jog",
        time_ms: 53_400,
        vertices: &[
            (0.48, 0.0), (0.43, 0.18), (0.34, 0.34), (0.18, 0.43), (0.0, 0.48),
            (-0.18, 0.43), (-0.34, 0.34), (-0.43, 0.18), (-0.48, 0.0), (-0.43, -0.18),
            (-0.34, -0.34), (-0.18, -0.43), (0.0, -0.48), (0.18, -0.43), (0.34, -0.34),
            (0.43, -0.18),
        ],
    },
    // novice
    SeedGhost {
        name: "Stroll",
        time_ms: 56_100,
        vertices: &[
            (0.50, 0.0), (0.46, 0.19), (0.35, 0.35), (0.19, 0.46), (0.0, 0.50),
            (-0.19, 0.46), (-0.35, 0.35), (-0.46, 0.19), (-0.50, 0.0), (-0.46, -0.19),
            (-0.35, -0.35), (-0.19, -0.46), (0.0, -0.50), (0.19, -0.46), (0.35, -0.35),
            (0.46, -0.19),
        ],
    },
    SeedGhost {
        name: "Wobble",
        time_ms: 59_800,
        vertices: &[
            (0.80, 0.0), (0.62, 0.48), (0.22, 0.76), (-0.22, 0.76), (-0.62, 0.48),
            (-0.80, 0.0), (-0.62, -0.48), (-0.22, -0.76), (0.22, -0.76), (0.62, -0.48),
        ],
    },
    SeedGhost {
        name: "Trundle",
        time_ms: 63_200,
        vertices: &[
            (0.42, 0.0), (0.38, 0.16), (0.28, 0.28), (0.16, 0.38), (0.0, 0.42),
            (-0.16, 0.38), (-0.28, 0.28), (-0.38, 0.16), (-0.42, 0.0), (-0.38, -0.16),
            (-0.28, -0.28), (-0.16, -0.38), (0.0, -0.42), (0.16, -0.38), (0.28, -0.28),
            (0.38, -0.16),
        ],
    },
    SeedGhost {
        name: "Amble",
        time_ms: 67_500,
        vertices: &[
            (0.66, 0.0), (0.58, 0.32), (0.38, 0.55), (0.12, 0.65), (-0.12, 0.65),
            (-0.38, 0.55), (-0.58, 0.32), (-0.66, 0.0), (-0.58, -0.32), (-0.38, -0.55),
            (-0.12, -0.65), (0.12, -0.65), (0.38, -0.55), (0.58, -0.32),
        ],
    },
    SeedGhost {
        name: "Slog",
        time_ms: 72_300,
        vertices: &[
            (0.36, 0.0), (0.33, 0.14), (0.25, 0.25), (0.14, 0.33), (0.0, 0.36),
            (-0.14, 0.33), (-0.25, 0.25), (-0.33, 0.14), (-0.36, 0.0), (-0.33, -0.14),
            (-0.25, -0.25), (-0.14, -0.33), (0.0, -0.36), (0.14, -0.33), (0.25, -0.25),
            (0.33, -0.14),
        ],
    },
    SeedGhost {
        name: "Putter",
        time_ms: 78_600,
        vertices: &[
            (0.75, 0.0), (0.68, 0.32), (0.48, 0.55), (0.22, 0.72), (0.0, 0.75),
            (-0.22, 0.72), (-0.48, 0.55), (-0.68, 0.32), (-0.75, 0.0), (-0.68, -0.32),
            (-0.48, -0.55), (-0.22, -0.72), (0.0, -0.75), (0.22, -0.72), (0.48, -0.55),
            (0.68, -0.32),
        ],
    },
    SeedGhost {
        name: "Crawl",
        time_ms: 85_400,
        vertices: &[
            (0.38, 0.0), (0.35, 0.15), (0.27, 0.27), (0.15, 0.35), (0.0, 0.38),
            (-0.15, 0.35), (-0.27, 0.27), (-0.35, 0.15), (-0.38, 0.0), (-0.35, -0.15),
            (-0.27, -0.27), (-0.15, -0.35),
        ],
    },
    SeedGhost {
        name: "Plod",
        time_ms: 92_700,
        vertices: &[
            (0.55, 0.0), (0.52, 0.17), (0.44, 0.32), (0.32, 0.44), (0.17, 0.52),
            (0.0, 0.55), (-0.17, 0.52), (-0.32, 0.44), (-0.44, 0.32), (-0.52, 0.17),
            (-0.55, 0.0), (-0.52, -0.17), (-0.44, -0.32), (-0.32, -0.44), (-0.17, -0.52),
            (0.0, -0.55),
        ],
    },
    SeedGhost {
        name: "Wade",
        time_ms: 101_600,
        vertices: &[
            (0.80, 0.0), (0.74, 0.15), (0.57, 0.28), (0.31, 0.37), (0.0, 0.40),
            (-0.31, 0.37), (-0.57, 0.28), (-0.74, 0.15), (-0.80, 0.0), (-0.74, -0.15),
            (-0.57, -0.28), (-0.31, -0.37), (0.0, -0.40), (0.31, -0.37), (0.57, -0.28),
            (0.74, -0.15),
        ],
    },
    SeedGhost {
        name: "Lumber",
        time_ms: 112_000,
        vertices: &[
            (0.44, 0.0), (0.38, 0.22), (0.22, 0.38), (0.0, 0.44), (-0.22, 0.38),
            (-0.38, 0.22), (-0.44, 0.0), (-0.38, -0.22), (-0.22, -0.38), (0.0, -0.44),
        ],
    },
    SeedGhost {
        name: "Dawdle",
        time_ms: 124_500,
        vertices: &[
            (0.60, 0.0), (0.52, 0.31), (0.31, 0.52), (0.0, 0.60), (-0.31, 0.52),
            (-0.52, 0.31), (-0.60, 0.0), (-0.52, -0.31), (-0.31, -0.52), (0.0, -0.60),
            (0.31, -0.52), (0.52, -0.31),
        ],
    },
];

/// Load seed ghosts into the database if none exist for the seed player.
/// Idempotent — safe to call on every startup.
pub async fn load_seeds_if_empty(
    pool: &PgPool,
    s3: &S3Client,
    s3_bucket: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let seed_uuid = Uuid::parse_str(SEED_PLAYER_UUID)?;

    // Check if seeds already loaded
    let count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM ghosts WHERE player_uuid = $1",
    )
    .bind(seed_uuid)
    .fetch_one(pool)
    .await?;

    if count.0 > 0 {
        tracing::info!(existing = count.0, "seed ghosts already loaded, skipping");
        return Ok(());
    }

    // Create seed player if needed
    sqlx::query(
        "INSERT INTO players (player_uuid) VALUES ($1) ON CONFLICT DO NOTHING",
    )
    .bind(seed_uuid)
    .execute(pool)
    .await?;

    // Claim display name for seed player
    sqlx::query(
        "INSERT INTO names (player_uuid, name, name_lowercase)
         VALUES ($1, 'SeedBot', 'seedbot')
         ON CONFLICT (player_uuid) DO NOTHING",
    )
    .bind(seed_uuid)
    .execute(pool)
    .await?;

    let mut loaded = 0u32;
    let now_millis = chrono::Utc::now().timestamp_millis();

    for (i, seed) in SEEDS.iter().enumerate() {
        let blob = encode_seed_blob(seed, now_millis - (SEEDS.len() - i) as i64 * 1000);
        let s3_key = format!("seeds/track_1/seed-{:03}", i);

        // Upload blob to S3
        s3.put_object()
            .bucket(s3_bucket)
            .key(&s3_key)
            .body(blob.into())
            .content_type("application/octet-stream")
            .send()
            .await
            .map_err(|e| {
                tracing::error!(seed = i, error = %e, "failed to upload seed ghost to S3");
                e
            })?;

        // Insert ghost row with is_pb = true so it appears in leaderboard_buckets
        sqlx::query(
            "INSERT INTO ghosts (ghost_id, player_uuid, track_id, physics_version, time_ms, is_pb, s3_key)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, true, $5)",
        )
        .bind(seed_uuid)
        .bind(TRACK_ID)
        .bind(PHYSICS_VERSION as i16)
        .bind(seed.time_ms as i32)
        .bind(&s3_key)
        .execute(pool)
        .await
        .map_err(|e| {
            tracing::error!(seed = i, error = %e, "failed to insert seed ghost");
            e
        })?;

        loaded += 1;
    }

    // Refresh the materialized view so matchmaking picks up new ghosts
    sqlx::query("REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_buckets")
        .execute(pool)
        .await
        .ok(); // Non-fatal

    tracing::info!(count = loaded, "seed ghosts loaded successfully");
    Ok(())
}

/// Encode a seed ghost into the DRGH binary format.
fn encode_seed_blob(seed: &SeedGhost, submitted_at: i64) -> Vec<u8> {
    let vertex_count = seed.vertices.len() as u8;
    assert!(
        (8..=32).contains(&vertex_count),
        "seed ghost must have 8-32 vertices, got {vertex_count}"
    );

    // Generate synthetic stroke points matching the polygon outline
    let stroke_points = generate_stroke(seed.vertices);

    let checkpoint_count: u8 = 0;
    let total_size = HEADER_SIZE
        + 1
        + (vertex_count as usize * 4)
        + 1
        + (stroke_points.len() * 6)
        + 1
        + (checkpoint_count as usize * 4);

    let mut buf = vec![0u8; total_size];

    // Magic "DRGH"
    buf[0..4].copy_from_slice(b"DRGH");
    buf[4] = PHYSICS_VERSION;
    buf[5..7].copy_from_slice(&(TRACK_ID as u16).to_le_bytes());
    buf[7] = 0; // flags
    buf[8..12].copy_from_slice(&seed.time_ms.to_le_bytes());
    buf[12..20].copy_from_slice(&submitted_at.to_le_bytes());

    let seed_uuid = Uuid::parse_str(SEED_PLAYER_UUID).unwrap();
    buf[20..36].copy_from_slice(seed_uuid.as_bytes());

    let mut offset = HEADER_SIZE;

    // Polygon vertices
    buf[offset] = vertex_count;
    offset += 1;
    for &(x, y) in seed.vertices {
        let ix = (x * 100.0).round() as i16;
        let iy = (y * 100.0).round() as i16;
        buf[offset..offset + 2].copy_from_slice(&ix.to_le_bytes());
        buf[offset + 2..offset + 4].copy_from_slice(&iy.to_le_bytes());
        offset += 4;
    }

    // Stroke points
    buf[offset] = stroke_points.len() as u8;
    offset += 1;
    for (dx, dy, dt) in &stroke_points {
        buf[offset..offset + 2].copy_from_slice(&dx.to_le_bytes());
        buf[offset + 2..offset + 4].copy_from_slice(&dy.to_le_bytes());
        buf[offset + 4..offset + 6].copy_from_slice(&dt.to_le_bytes());
        offset += 6;
    }

    // Checkpoints
    buf[offset] = checkpoint_count;

    buf
}

/// Generate synthetic delta-encoded stroke points tracing the polygon outline.
fn generate_stroke(vertices: &[(f64, f64)]) -> Vec<(i16, i16, u16)> {
    let mut points = Vec::new();
    let mut prev_x = 0.0_f64;
    let mut prev_y = 0.0_f64;
    let mut t = 0u16;

    for &(vx, vy) in vertices {
        let px = vx * 100.0;
        let py = vy * 100.0;
        let dx = ((px - prev_x).round()) as i16;
        let dy = ((py - prev_y).round()) as i16;
        let dt = 16u16; // 16ms between points
        t = t.saturating_add(dt);
        points.push((dx, dy, dt));
        prev_x = px;
        prev_y = py;
    }

    points
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seeds_count_within_range() {
        assert!(SEEDS.len() >= 20, "need at least 20 seeds, got {}", SEEDS.len());
        assert!(SEEDS.len() <= 35, "too many seeds, got {}", SEEDS.len());
    }

    #[test]
    fn all_seeds_have_valid_vertices() {
        for (i, seed) in SEEDS.iter().enumerate() {
            assert!(
                (8..=32).contains(&seed.vertices.len()),
                "seed {i} has {} vertices, need 8-32",
                seed.vertices.len()
            );
        }
    }

    #[test]
    fn seeds_ordered_by_time() {
        for window in SEEDS.windows(2) {
            assert!(
                window[0].time_ms < window[1].time_ms,
                "seeds must be ordered fastest to slowest: {} not < {}",
                window[0].time_ms,
                window[1].time_ms
            );
        }
    }

    #[test]
    fn encode_seed_blob_roundtrip() {
        let seed = &SEEDS[0];
        let blob = encode_seed_blob(seed, 1_700_000_000_000);

        // Parse header
        assert_eq!(&blob[0..4], b"DRGH");
        assert_eq!(blob[4], PHYSICS_VERSION);
        let track_id = u16::from_le_bytes([blob[5], blob[6]]);
        assert_eq!(track_id, TRACK_ID as u16);
        let time_ms = u32::from_le_bytes([blob[8], blob[9], blob[10], blob[11]]);
        assert_eq!(time_ms, seed.time_ms);

        // Parse via blob module
        let parsed = crate::blob::GhostBlob::parse(&blob).unwrap();
        assert_eq!(parsed.vertex_count as usize, seed.vertices.len());
        assert_eq!(parsed.point_count as usize, parsed.stroke_points.len());
    }

    #[test]
    fn seed_player_uuid_is_valid() {
        assert!(Uuid::parse_str(SEED_PLAYER_UUID).is_ok());
    }

    #[test]
    fn all_blobs_parse_cleanly() {
        let now = 1_700_000_000_000;
        for (i, seed) in SEEDS.iter().enumerate() {
            let blob = encode_seed_blob(seed, now + i as i64);
            let parsed = crate::blob::GhostBlob::parse(&blob);
            assert!(parsed.is_ok(), "seed {i} failed to parse: {:?}", parsed.err());
        }
    }

    #[test]
    fn bucket_coverage() {
        // With 25 seeds ordered fastest to slowest, verify each bucket gets at least 1 ghost
        let n = SEEDS.len() as f64;
        let mut buckets = std::collections::HashSet::new();
        for i in 0..SEEDS.len() {
            let pr = i as f64 / (n - 1.0);
            let bucket = if pr <= 0.01 {
                "elite"
            } else if pr <= 0.05 {
                "advanced"
            } else if pr <= 0.20 {
                "skilled"
            } else if pr <= 0.50 {
                "mid"
            } else {
                "novice"
            };
            buckets.insert(bucket);
        }
        assert_eq!(buckets.len(), 5, "need coverage of all 5 buckets, got {buckets:?}");
    }
}
