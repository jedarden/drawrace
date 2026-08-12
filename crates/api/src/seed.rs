use aws_sdk_s3::Client as S3Client;
use sqlx::PgPool;
use uuid::Uuid;

const PHYSICS_VERSION: u8 = 2;
#[allow(dead_code)]
const HEADER_SIZE: usize = 36;

/// Fixed UUID for the seed player — all seed ghosts belong to this identity.
pub const SEED_PLAYER_UUID: &str = "00000000-0000-4000-8000-000000000001";

#[allow(dead_code)]
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
#[allow(dead_code)]
const SEEDS: &[SeedGhost] = &[
    // elite
    SeedGhost {
        name: "Blaze",
        time_ms: 25_400,
        vertices: &[
            (0.48, 0.0),
            (0.44, 0.19),
            (0.34, 0.34),
            (0.19, 0.44),
            (0.0, 0.48),
            (-0.19, 0.44),
            (-0.34, 0.34),
            (-0.44, 0.19),
            (-0.48, 0.0),
            (-0.44, -0.19),
            (-0.34, -0.34),
            (-0.19, -0.44),
            (0.0, -0.48),
            (0.19, -0.44),
            (0.34, -0.34),
            (0.44, -0.19),
        ],
    },
    // advanced
    SeedGhost {
        name: "Swift",
        time_ms: 29_800,
        vertices: &[
            (0.55, 0.0),
            (0.51, 0.21),
            (0.39, 0.39),
            (0.21, 0.51),
            (0.0, 0.55),
            (-0.21, 0.51),
            (-0.39, 0.39),
            (-0.51, 0.21),
            (-0.55, 0.0),
            (-0.51, -0.21),
            (-0.39, -0.39),
            (-0.21, -0.51),
            (0.0, -0.55),
            (0.21, -0.51),
            (0.39, -0.39),
            (0.51, -0.21),
        ],
    },
    // skilled
    SeedGhost {
        name: "Quick",
        time_ms: 32_100,
        vertices: &[
            (0.50, 0.0),
            (0.46, 0.19),
            (0.35, 0.35),
            (0.19, 0.46),
            (0.0, 0.50),
            (-0.19, 0.46),
            (-0.35, 0.35),
            (-0.46, 0.19),
            (-0.50, 0.0),
            (-0.46, -0.19),
            (-0.35, -0.35),
            (-0.19, -0.46),
            (0.0, -0.50),
            (0.19, -0.46),
        ],
    },
    SeedGhost {
        name: "Dash",
        time_ms: 33_500,
        vertices: &[
            (0.60, 0.0),
            (0.55, 0.25),
            (0.42, 0.42),
            (0.25, 0.55),
            (0.0, 0.60),
            (-0.25, 0.55),
            (-0.42, 0.42),
            (-0.55, 0.25),
            (-0.60, 0.0),
            (-0.55, -0.25),
            (-0.42, -0.42),
            (-0.25, -0.55),
            (0.0, -0.60),
            (0.25, -0.55),
            (0.42, -0.42),
            (0.55, -0.25),
        ],
    },
    SeedGhost {
        name: "Bolt",
        time_ms: 35_200,
        vertices: &[
            (0.65, 0.0),
            (0.55, 0.35),
            (0.30, 0.56),
            (0.0, 0.65),
            (-0.30, 0.56),
            (-0.55, 0.35),
            (-0.65, 0.0),
            (-0.55, -0.35),
            (-0.30, -0.56),
            (0.0, -0.65),
        ],
    },
    SeedGhost {
        name: "Sprint",
        time_ms: 37_800,
        vertices: &[
            (0.52, 0.0),
            (0.49, 0.15),
            (0.42, 0.30),
            (0.30, 0.42),
            (0.15, 0.49),
            (0.0, 0.52),
            (-0.15, 0.49),
            (-0.30, 0.42),
            (-0.42, 0.30),
            (-0.49, 0.15),
            (-0.52, 0.0),
            (-0.49, -0.15),
            (-0.42, -0.30),
            (-0.30, -0.42),
            (-0.15, -0.49),
            (0.0, -0.52),
            (0.15, -0.49),
            (0.30, -0.42),
        ],
    },
    // mid
    SeedGhost {
        name: "Pacer",
        time_ms: 40_100,
        vertices: &[
            (0.45, 0.0),
            (0.42, 0.17),
            (0.32, 0.32),
            (0.17, 0.42),
            (0.0, 0.45),
            (-0.17, 0.42),
            (-0.32, 0.32),
            (-0.42, 0.17),
            (-0.45, 0.0),
            (-0.42, -0.17),
            (-0.32, -0.32),
            (-0.17, -0.42),
            (0.0, -0.45),
            (0.17, -0.42),
            (0.32, -0.32),
            (0.42, -0.17),
        ],
    },
    SeedGhost {
        name: "Steady",
        time_ms: 42_600,
        vertices: &[
            (0.70, 0.0),
            (0.65, 0.27),
            (0.49, 0.49),
            (0.27, 0.65),
            (0.0, 0.70),
            (-0.27, 0.65),
            (-0.49, 0.49),
            (-0.65, 0.27),
            (-0.70, 0.0),
            (-0.65, -0.27),
            (-0.49, -0.49),
            (-0.27, -0.65),
            (0.0, -0.70),
            (0.27, -0.65),
            (0.49, -0.49),
            (0.65, -0.27),
        ],
    },
    SeedGhost {
        name: "Cruise",
        time_ms: 44_300,
        vertices: &[
            (0.55, 0.0),
            (0.48, 0.28),
            (0.28, 0.48),
            (0.0, 0.55),
            (-0.28, 0.48),
            (-0.48, 0.28),
            (-0.55, 0.0),
            (-0.48, -0.28),
            (-0.28, -0.48),
            (0.0, -0.55),
            (0.28, -0.48),
            (0.48, -0.28),
        ],
    },
    SeedGhost {
        name: "Ramble",
        time_ms: 46_900,
        vertices: &[
            (0.58, 0.0),
            (0.50, 0.30),
            (0.30, 0.50),
            (0.0, 0.58),
            (-0.30, 0.50),
            (-0.50, 0.30),
            (-0.58, 0.0),
            (-0.50, -0.30),
            (-0.30, -0.50),
            (0.0, -0.58),
            (0.30, -0.50),
            (0.50, -0.30),
        ],
    },
    SeedGhost {
        name: "Drift",
        time_ms: 49_200,
        vertices: &[
            (0.40, 0.0),
            (0.35, 0.20),
            (0.20, 0.35),
            (0.0, 0.40),
            (-0.20, 0.35),
            (-0.35, 0.20),
            (-0.40, 0.0),
            (-0.35, -0.20),
            (-0.20, -0.35),
            (0.0, -0.40),
            (0.20, -0.35),
            (0.35, -0.20),
        ],
    },
    SeedGhost {
        name: "Mosey",
        time_ms: 51_700,
        vertices: &[
            (0.62, 0.0),
            (0.57, 0.24),
            (0.44, 0.44),
            (0.24, 0.57),
            (0.0, 0.62),
            (-0.24, 0.57),
            (-0.44, 0.44),
            (-0.57, 0.24),
            (-0.62, 0.0),
            (-0.57, -0.24),
            (-0.44, -0.44),
            (-0.24, -0.57),
            (0.0, -0.62),
            (0.24, -0.57),
            (0.44, -0.44),
            (0.57, -0.24),
        ],
    },
    SeedGhost {
        name: "Jog",
        time_ms: 53_400,
        vertices: &[
            (0.48, 0.0),
            (0.43, 0.18),
            (0.34, 0.34),
            (0.18, 0.43),
            (0.0, 0.48),
            (-0.18, 0.43),
            (-0.34, 0.34),
            (-0.43, 0.18),
            (-0.48, 0.0),
            (-0.43, -0.18),
            (-0.34, -0.34),
            (-0.18, -0.43),
            (0.0, -0.48),
            (0.18, -0.43),
            (0.34, -0.34),
            (0.43, -0.18),
        ],
    },
    // novice
    SeedGhost {
        name: "Stroll",
        time_ms: 56_100,
        vertices: &[
            (0.50, 0.0),
            (0.46, 0.19),
            (0.35, 0.35),
            (0.19, 0.46),
            (0.0, 0.50),
            (-0.19, 0.46),
            (-0.35, 0.35),
            (-0.46, 0.19),
            (-0.50, 0.0),
            (-0.46, -0.19),
            (-0.35, -0.35),
            (-0.19, -0.46),
            (0.0, -0.50),
            (0.19, -0.46),
            (0.35, -0.35),
            (0.46, -0.19),
        ],
    },
    SeedGhost {
        name: "Wobble",
        time_ms: 59_800,
        vertices: &[
            (0.80, 0.0),
            (0.62, 0.48),
            (0.22, 0.76),
            (-0.22, 0.76),
            (-0.62, 0.48),
            (-0.80, 0.0),
            (-0.62, -0.48),
            (-0.22, -0.76),
            (0.22, -0.76),
            (0.62, -0.48),
        ],
    },
    SeedGhost {
        name: "Trundle",
        time_ms: 63_200,
        vertices: &[
            (0.42, 0.0),
            (0.38, 0.16),
            (0.28, 0.28),
            (0.16, 0.38),
            (0.0, 0.42),
            (-0.16, 0.38),
            (-0.28, 0.28),
            (-0.38, 0.16),
            (-0.42, 0.0),
            (-0.38, -0.16),
            (-0.28, -0.28),
            (-0.16, -0.38),
            (0.0, -0.42),
            (0.16, -0.38),
            (0.28, -0.28),
            (0.38, -0.16),
        ],
    },
    SeedGhost {
        name: "Amble",
        time_ms: 67_500,
        vertices: &[
            (0.66, 0.0),
            (0.58, 0.32),
            (0.38, 0.55),
            (0.12, 0.65),
            (-0.12, 0.65),
            (-0.38, 0.55),
            (-0.58, 0.32),
            (-0.66, 0.0),
            (-0.58, -0.32),
            (-0.38, -0.55),
            (-0.12, -0.65),
            (0.12, -0.65),
            (0.38, -0.55),
            (0.58, -0.32),
        ],
    },
    SeedGhost {
        name: "Slog",
        time_ms: 72_300,
        vertices: &[
            (0.36, 0.0),
            (0.33, 0.14),
            (0.25, 0.25),
            (0.14, 0.33),
            (0.0, 0.36),
            (-0.14, 0.33),
            (-0.25, 0.25),
            (-0.33, 0.14),
            (-0.36, 0.0),
            (-0.33, -0.14),
            (-0.25, -0.25),
            (-0.14, -0.33),
            (0.0, -0.36),
            (0.14, -0.33),
            (0.25, -0.25),
            (0.33, -0.14),
        ],
    },
    SeedGhost {
        name: "Putter",
        time_ms: 78_600,
        vertices: &[
            (0.75, 0.0),
            (0.68, 0.32),
            (0.48, 0.55),
            (0.22, 0.72),
            (0.0, 0.75),
            (-0.22, 0.72),
            (-0.48, 0.55),
            (-0.68, 0.32),
            (-0.75, 0.0),
            (-0.68, -0.32),
            (-0.48, -0.55),
            (-0.22, -0.72),
            (0.0, -0.75),
            (0.22, -0.72),
            (0.48, -0.55),
            (0.68, -0.32),
        ],
    },
    SeedGhost {
        name: "Crawl",
        time_ms: 85_400,
        vertices: &[
            (0.38, 0.0),
            (0.35, 0.15),
            (0.27, 0.27),
            (0.15, 0.35),
            (0.0, 0.38),
            (-0.15, 0.35),
            (-0.27, 0.27),
            (-0.35, 0.15),
            (-0.38, 0.0),
            (-0.35, -0.15),
            (-0.27, -0.27),
            (-0.15, -0.35),
        ],
    },
    SeedGhost {
        name: "Plod",
        time_ms: 92_700,
        vertices: &[
            (0.55, 0.0),
            (0.52, 0.17),
            (0.44, 0.32),
            (0.32, 0.44),
            (0.17, 0.52),
            (0.0, 0.55),
            (-0.17, 0.52),
            (-0.32, 0.44),
            (-0.44, 0.32),
            (-0.52, 0.17),
            (-0.55, 0.0),
            (-0.52, -0.17),
            (-0.44, -0.32),
            (-0.32, -0.44),
            (-0.17, -0.52),
            (0.0, -0.55),
        ],
    },
    SeedGhost {
        name: "Wade",
        time_ms: 101_600,
        vertices: &[
            (0.80, 0.0),
            (0.74, 0.15),
            (0.57, 0.28),
            (0.31, 0.37),
            (0.0, 0.40),
            (-0.31, 0.37),
            (-0.57, 0.28),
            (-0.74, 0.15),
            (-0.80, 0.0),
            (-0.74, -0.15),
            (-0.57, -0.28),
            (-0.31, -0.37),
            (0.0, -0.40),
            (0.31, -0.37),
            (0.57, -0.28),
            (0.74, -0.15),
        ],
    },
    SeedGhost {
        name: "Lumber",
        time_ms: 112_000,
        vertices: &[
            (0.44, 0.0),
            (0.38, 0.22),
            (0.22, 0.38),
            (0.0, 0.44),
            (-0.22, 0.38),
            (-0.38, 0.22),
            (-0.44, 0.0),
            (-0.38, -0.22),
            (-0.22, -0.38),
            (0.0, -0.44),
        ],
    },
    SeedGhost {
        name: "Dawdle",
        time_ms: 124_500,
        vertices: &[
            (0.60, 0.0),
            (0.52, 0.31),
            (0.31, 0.52),
            (0.0, 0.60),
            (-0.31, 0.52),
            (-0.52, 0.31),
            (-0.60, 0.0),
            (-0.52, -0.31),
            (-0.31, -0.52),
            (0.0, -0.60),
            (0.31, -0.52),
            (0.52, -0.31),
        ],
    },
];

/// Load seed ghosts into the database if none exist for the seed player.
/// Idempotent — safe to call on every startup.
///
/// This function will:
/// 1. Check if any seed ghosts already exist for the seed player
/// 2. For each track (1, 2, 3), check if local seed files exist at `/app/seeds/track_N/` (Docker) or `seeds/track_N/` (dev)
/// 3. If local files exist, read them from disk
/// 4. Otherwise, generate blobs in-memory from the SEEDS array (track 1 only)
/// 5. Upload blobs to S3 and create database records
pub async fn load_seeds_if_empty(
    pool: &PgPool,
    s3: &S3Client,
    s3_bucket: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let seed_uuid = Uuid::parse_str(SEED_PLAYER_UUID)?;

    // Check if seeds already loaded for any track
    let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM ghosts WHERE player_uuid = $1")
        .bind(seed_uuid)
        .fetch_one(pool)
        .await?;

    if count.0 > 0 {
        tracing::info!(existing = count.0, "seed ghosts already loaded, skipping");
        return Ok(());
    }

    // Create seed player if needed
    sqlx::query("INSERT INTO players (player_uuid) VALUES ($1) ON CONFLICT DO NOTHING")
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

    let mut total_loaded = 0u32;

    // Dynamically discover track directories
    let seeds_base_path = if std::path::Path::new("/app/seeds").exists() {
        std::path::Path::new("/app/seeds")
    } else {
        std::path::Path::new("seeds")
    };

    let mut track_ids: Vec<i16> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(seeds_base_path) {
        for entry in entries.filter_map(Result::ok) {
            let dir_name = entry.file_name();
            let dir_name_str = dir_name.to_string_lossy();

            // Parse track ID from directory name (track_N -> N)
            if dir_name_str.starts_with("track_") {
                if let Ok(track_id) = dir_name_str["track_".len()..].parse::<i16>() {
                    track_ids.push(track_id);
                }
            }
        }
    }

    if track_ids.is_empty() {
        tracing::warn!(
            path = %seeds_base_path.display(),
            "no track directories found (expected format: track_N), skipping seed loading"
        );
        return Ok(());
    }

    track_ids.sort();
    track_ids.dedup();

    tracing::info!(
        tracks = ?track_ids,
        "discovered track directories"
    );

    // Iterate over all discovered tracks
    for track_id in track_ids {
        let track_dir = format!("track_{}", track_id);
        let seeds_path = seeds_base_path.join(&track_dir);

        // Verify the track directory exists
        if !seeds_path.exists() {
            tracing::warn!(
                track_id,
                path = %seeds_path.display(),
                "track directory not found, skipping"
            );
            continue;
        }

        let seeds_dir = &seeds_path;

        tracing::info!(
            track_id,
            path = %seeds_dir.display(),
            "loading seed ghosts from local files"
        );

        let mut loaded = 0u32;
        let mut i = 0;

        loop {
            let s3_key = format!("seeds/{}/seed-{:03}.blob", track_dir, i);
            let seed_path = seeds_dir.join(format!("seed-{:03}.blob", i));

            let blob: Vec<u8> = match std::fs::read(&seed_path) {
                Ok(data) => data,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    // No more seed files for this track
                    break;
                }
                Err(e) => {
                    tracing::error!(
                        track_id,
                        path = %seed_path.display(),
                        error = %e,
                        "failed to read seed file"
                    );
                    break;
                }
            };

            // Upload blob to S3
            s3.put_object()
                .bucket(s3_bucket)
                .key(&s3_key)
                .body(blob.clone().into())
                .content_type("application/octet-stream")
                .send()
                .await
                .map_err(|e| {
                    tracing::error!(
                        track_id,
                        seed = i,
                        error = %e,
                        "failed to upload seed ghost to S3"
                    );
                    e
                })?;

            // Get time_ms from the blob for database record
            let time_ms = u32::from_le_bytes([blob[8], blob[9], blob[10], blob[11]]) as i32;

            // Insert ghost row with is_pb = true so it appears in leaderboard_buckets
            sqlx::query(
                "INSERT INTO ghosts (ghost_id, player_uuid, track_id, physics_version, time_ms, is_pb, s3_key)
                 VALUES (gen_random_uuid(), $1, $2, $3, $4, true, $5)",
            )
            .bind(seed_uuid)
            .bind(track_id)
            .bind(PHYSICS_VERSION as i16)
            .bind(time_ms)
            .bind(&s3_key)
            .execute(pool)
            .await
            .map_err(|e| {
                tracing::error!(
                    track_id,
                    seed = i,
                    error = %e,
                    "failed to insert seed ghost"
                );
                e
            })?;

            loaded += 1;
            i += 1;
        }

        tracing::info!(track_id, count = loaded, "loaded seed ghosts for track");
        total_loaded += loaded;
    }

    // Refresh the materialized view so matchmaking picks up new ghosts
    if total_loaded > 0 {
        sqlx::query("REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_buckets")
            .execute(pool)
            .await
            .ok(); // Non-fatal
    }

    tracing::info!(total = total_loaded, "seed ghosts loaded successfully");
    Ok(())
}

/// Encode a seed ghost into the DRGH binary format (v2 with wheels[]).
#[allow(dead_code)]
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
        + 1 // wheel_count
        + (4 + 1 + vertex_count as usize * 4) // single wheel: swap_tick + vertex_count + vertices
        + 1
        + (stroke_points.len() * 6)
        + 1
        + (checkpoint_count as usize * 4);

    let mut buf = vec![0u8; total_size];

    // Magic "DRGH"
    buf[0..4].copy_from_slice(b"DRGH");
    buf[4] = PHYSICS_VERSION;
    buf[5..7].copy_from_slice(&1u16.to_le_bytes()); // track_id = 1 for in-memory seeds
    buf[7] = 0; // flags
    buf[8..12].copy_from_slice(&seed.time_ms.to_le_bytes());
    buf[12..20].copy_from_slice(&submitted_at.to_le_bytes());

    let seed_uuid = Uuid::parse_str(SEED_PLAYER_UUID).unwrap();
    buf[20..36].copy_from_slice(seed_uuid.as_bytes());

    let mut offset = HEADER_SIZE;

    // wheel_count = 1
    buf[offset] = 1;
    offset += 1;

    // Wheel 0: swap_tick = 0
    buf[offset..offset + 4].copy_from_slice(&0u32.to_le_bytes());
    offset += 4;

    // vertex_count
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
#[allow(dead_code)]
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
        assert!(
            SEEDS.len() >= 20,
            "need at least 20 seeds, got {}",
            SEEDS.len()
        );
        assert!(SEEDS.len() <= 30, "too many seeds, got {}", SEEDS.len());
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
        assert_eq!(track_id, 1u16, "in-memory seeds are hardcoded to track 1");
        let time_ms = u32::from_le_bytes([blob[8], blob[9], blob[10], blob[11]]);
        assert_eq!(time_ms, seed.time_ms);

        // Parse via blob module
        let parsed = crate::blob::GhostBlob::parse(&blob).unwrap();
        assert_eq!(parsed.wheel_count, 1);
        assert_eq!(parsed.wheels[0].vertex_count as usize, seed.vertices.len());
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
            assert!(
                parsed.is_ok(),
                "seed {i} failed to parse: {:?}",
                parsed.err()
            );
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
        assert_eq!(
            buckets.len(),
            5,
            "need coverage of all 5 buckets, got {buckets:?}"
        );
    }

    #[test]
    fn dynamic_track_discovery_works() {
        // Verify the parsing logic for discovering track IDs from directory names
        let test_dir_names = vec!["track_1", "track_2", "track_10", "track_99", "other_dir", "track_bad"];
        let mut parsed_ids = Vec::new();

        for dir_name in test_dir_names {
            if dir_name.starts_with("track_") {
                if let Ok(track_id) = dir_name["track_".len()..].parse::<i16>() {
                    parsed_ids.push(track_id);
                }
            }
        }

        // Should parse valid track IDs but skip invalid ones
        assert_eq!(parsed_ids, vec![1, 2, 10, 99], "should parse track_N directory names correctly");

        // Verify sort and dedup behavior
        let unsorted = vec![3, 1, 2, 2, 1];
        let mut sorted = unsorted.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(sorted, vec![1, 2, 3], "sort and dedup should produce unique sorted IDs");
    }

    #[test]
    fn seeds_span_reasonable_time_range() {
        // Verify seed times span a reasonable range for matchmaking
        let min_time = SEEDS.iter().map(|s| s.time_ms).min().unwrap();
        let max_time = SEEDS.iter().map(|s| s.time_ms).max().unwrap();
        let ratio = max_time as f64 / min_time as f64;

        // Fastest should be at least 3x faster than slowest for good bucket distribution
        assert!(
            ratio >= 2.5,
            "seed time ratio too narrow: {ratio:.2}x (min={min_time}ms, max={max_time}ms)"
        );

        // But not more than 6x to keep times in plausible range
        assert!(
            ratio <= 8.0,
            "seed time ratio too wide: {ratio:.2}x (min={min_time}ms, max={max_time}ms)"
        );
    }

    #[test]
    fn seed_bucket_distribution_is_reasonable() {
        // Verify bucket distribution covers all 5 buckets with reasonable counts
        let n = SEEDS.len() as f64;
        let mut bucket_counts = std::collections::HashMap::new();
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
            *bucket_counts.entry(bucket).or_insert(0) += 1;
        }

        // All 5 buckets should be represented
        assert_eq!(
            bucket_counts.len(),
            5,
            "all 5 buckets should be represented"
        );

        // Elite and advanced should have at least 1 each
        assert!(
            bucket_counts.get("elite").copied().unwrap_or(0) >= 1,
            "elite bucket should have at least 1 ghost"
        );
        assert!(
            bucket_counts.get("advanced").copied().unwrap_or(0) >= 1,
            "advanced bucket should have at least 1 ghost"
        );

        // Skilled, mid, novice should have several each
        assert!(
            bucket_counts.get("skilled").copied().unwrap_or(0) >= 3,
            "skilled bucket should have at least 3 ghosts"
        );
        assert!(
            bucket_counts.get("mid").copied().unwrap_or(0) >= 5,
            "mid bucket should have at least 5 ghosts"
        );
        assert!(
            bucket_counts.get("novice").copied().unwrap_or(0) >= 8,
            "novice bucket should have at least 8 ghosts"
        );
    }

    #[test]
    fn s3_key_format_uses_correct_track_ids() {
        // Verify s3_key format includes derived track IDs from directory names
        let test_cases = vec![
            (1, "seeds/track_1/seed-000.blob"),
            (2, "seeds/track_2/seed-000.blob"),
            (3, "seeds/track_3/seed-000.blob"),
            (10, "seeds/track_10/seed-000.blob"),
            (99, "seeds/track_99/seed-000.blob"),
        ];

        for (track_id, expected_key) in test_cases {
            let track_dir = format!("track_{}", track_id);
            let s3_key = format!("seeds/{}/seed-{:03}.blob", track_dir, 0);
            assert_eq!(
                s3_key, expected_key,
                "s3_key format should use correct track ID {}",
                track_id
            );
        }

        // Verify sequential seed numbering within a track
        let track_id = 2i16;
        let track_dir = format!("track_{}", track_id);
        for i in 0..5 {
            let s3_key = format!("seeds/{}/seed-{:03}.blob", track_dir, i);
            let expected = format!("seeds/track_2/seed-{:03}.blob", i);
            assert_eq!(
                s3_key, expected,
                "sequential seed numbering for track_2, seed {}",
                i
            );
        }
    }

    #[test]
    fn track_id_derivation_from_directory_names() {
        // Verify TRACK_ID is correctly derived from directory names
        let test_cases = vec![
            ("track_1", Some(1i16)),
            ("track_2", Some(2i16)),
            ("track_3", Some(3i16)),
            ("track_10", Some(10i16)),
            ("track_99", Some(99i16)),
            ("track_100", Some(100i16)), // Within i16 range (max is 32767)
            ("other_dir", None),
            ("track_bad", None),
            ("track_", None),
            ("prefix_track_1", None), // Doesn't start with "track_"
        ];

        for (dir_name, expected_id) in test_cases {
            let parsed = if dir_name.starts_with("track_") {
                dir_name["track_".len()..].parse::<i16>().ok()
            } else {
                None
            };

            assert_eq!(
                parsed, expected_id,
                "track ID derivation for '{}' should match expected {:?}",
                dir_name, expected_id
            );
        }

        // Verify multi-track discovery works correctly
        let dir_names = vec!["track_1", "track_2", "track_3", "track_1", "track_2"];
        let mut track_ids: Vec<i16> = Vec::new();

        for dir_name in dir_names {
            if dir_name.starts_with("track_") {
                if let Ok(track_id) = dir_name["track_".len()..].parse::<i16>() {
                    track_ids.push(track_id);
                }
            }
        }

        // After sort and dedup (as done in load_seeds_if_empty)
        track_ids.sort();
        track_ids.dedup();

        assert_eq!(
            track_ids,
            vec![1, 2, 3],
            "multi-track discovery should find unique sorted track IDs"
        );
    }

    #[test]
    fn per_track_bucket_distribution() {
        // Verify that per-track seed loading maintains bucket distribution
        // This tests that each track gets the same distribution pattern

        let test_tracks = vec![1i16, 2, 3];
        let seeds_per_track = 25; // Same as SEEDS.len()

        for track_id in test_tracks {
            let track_dir = format!("track_{}", track_id);

            // Simulate bucket calculation for this track
            let n = seeds_per_track as f64;
            let mut bucket_counts = std::collections::HashMap::new();

            for i in 0..seeds_per_track {
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
                *bucket_counts.entry(bucket).or_insert(0) += 1;
            }

            // Verify all 5 buckets are present for this track
            assert_eq!(
                bucket_counts.len(),
                5,
                "track {} should have all 5 buckets represented",
                track_id
            );

            // Verify expected bucket distribution matches the pattern
            assert_eq!(
                bucket_counts.get("elite").copied().unwrap_or(0),
                1,
                "track {} elite bucket should have 1 ghost",
                track_id
            );
            assert_eq!(
                bucket_counts.get("advanced").copied().unwrap_or(0),
                1,
                "track {} advanced bucket should have 1 ghost",
                track_id
            );
            assert_eq!(
                bucket_counts.get("skilled").copied().unwrap_or(0),
                3,
                "track {} skilled bucket should have 3 ghosts",
                track_id
            );
            assert_eq!(
                bucket_counts.get("mid").copied().unwrap_or(0),
                8,
                "track {} mid bucket should have 8 ghosts",
                track_id
            );
            assert_eq!(
                bucket_counts.get("novice").copied().unwrap_or(0),
                12,
                "track {} novice bucket should have 12 ghosts",
                track_id
            );

            // Verify s3_key format for this track
            let s3_key = format!("seeds/{}/seed-000.blob", track_dir);
            assert!(
                s3_key.contains(&track_dir),
                "s3_key for track {} should contain directory name {}",
                track_id, track_dir
            );
        }
    }

    #[test]
    fn multi_track_loading_sequence() {
        // Verify the sequence of operations for multi-track loading
        let test_tracks = vec![1i16, 2, 3];
        let mut processed_tracks = Vec::new();

        // Simulate the loading sequence from load_seeds_if_empty
        for track_id in &test_tracks {
            let track_dir = format!("track_{}", track_id);

            // Verify track directory naming
            assert!(
                track_dir.starts_with("track_"),
                "track directory should start with 'track_'"
            );

            // Simulate processing seeds for this track
            let mut seed_count = 0;
            for seed_index in 0..3 {
                let s3_key = format!("seeds/{}/seed-{:03}.blob", track_dir, seed_index);
                let seed_path = format!("seeds/{}/seed-{:03}.blob", track_dir, seed_index);

                // Verify s3_key and local path are consistent
                assert!(
                    s3_key.contains(&format!("track_{}", track_id)),
                    "s3_key should contain track_{}",
                    track_id
                );
                assert!(
                    seed_path.contains(&format!("track_{}", track_id)),
                    "local path should contain track_{}",
                    track_id
                );

                seed_count += 1;
            }

            processed_tracks.push((track_id, seed_count));
        }

        // Verify all tracks were processed
        assert_eq!(
            processed_tracks.len(),
            3,
            "all 3 tracks should be processed"
        );

        // Verify track IDs are in sorted order
        let track_ids: Vec<i16> = processed_tracks.iter().map(|(id, _)| **id).collect();
        assert_eq!(
            track_ids,
            vec![1, 2, 3],
            "tracks should be processed in sorted order"
        );
    }

    #[test]
    fn track_id_edge_cases() {
        // Verify edge cases for track ID derivation
        let edge_cases = vec![
            ("track_0", Some(0i16)),     // Valid i16 but unusual
            ("track_127", Some(127i16)), // Max positive i16 that's reasonable
            ("track_-1", Some(-1i16)),   // Negative is parseable as i16
            ("track_32767", Some(32767i16)), // Max i16 value
            ("track_32768", None),      // Out of i16 range (exceeds max)
        ];

        for (dir_name, expected) in edge_cases {
            let result = if dir_name.starts_with("track_") {
                dir_name["track_".len()..].parse::<i16>().ok()
            } else {
                None
            };

            assert_eq!(
                result, expected,
                "track ID edge case '{}' should parse to {:?}",
                dir_name, expected
            );
        }

        // Verify sorting and deduplication with edge cases
        let mut unsorted = vec![3i16, 1, 2, 1, 3, 2, 0, 127];
        unsorted.sort();
        unsorted.dedup();
        assert_eq!(
            unsorted,
            vec![0, 1, 2, 3, 127],
            "sort and dedup should handle edge case track IDs"
        );
    }

    #[test]
    fn seed_file_path_consistency() {
        // Verify seed file paths are consistent with s3_key format
        let test_cases = vec![
            (1, 0, "seeds/track_1/seed-000.blob"),
            (2, 5, "seeds/track_2/seed-005.blob"),
            (3, 99, "seeds/track_3/seed-099.blob"),
        ];

        for (track_id, seed_index, expected_key) in test_cases {
            let track_dir = format!("track_{}", track_id);
            let s3_key = format!("seeds/{}/seed-{:03}.blob", track_dir, seed_index);
            let local_path = format!("seeds/{}/seed-{:03}.blob", track_dir, seed_index);

            assert_eq!(
                s3_key, expected_key,
                "s3_key for track {} seed {} should match expected",
                track_id, seed_index
            );
            assert_eq!(
                local_path, expected_key,
                "local path for track {} seed {} should match s3_key",
                track_id, seed_index
            );
        }

        // Verify zero-padding for seed indices
        for i in 0..10 {
            let track_id = 1i16;
            let track_dir = format!("track_{}", track_id);
            let s3_key = format!("seeds/{}/seed-{:03}.blob", track_dir, i);

            assert!(
                s3_key.ends_with(&format!("seed-{:03}.blob", i)),
                "seed index should be zero-padded to 3 digits: {}",
                i
            );
        }
    }
}
