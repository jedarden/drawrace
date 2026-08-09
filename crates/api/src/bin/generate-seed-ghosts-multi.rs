//! Generate seed ghost blob files for multiple tracks.
//!
//! Usage: cargo run --bin generate-seed-ghosts-multi -- <TRACK_ID> [TARGET_TIME_MS]
//!
//! This binary creates 25 ghost blob files covering all 5 buckets (elite, advanced,
//! skilled, mid, novice) and saves them to seeds/track_<TRACK_ID>/ directory.

use std::env;
use std::fs;
use std::process;
use uuid::Uuid;

const PHYSICS_VERSION: u8 = 8;
const HEADER_SIZE: usize = 36;
const SEED_PLAYER_UUID: &str = "00000000-0000-4000-8000-000000000001";

struct SeedGhost {
    name: &'static str,
    time_ms: u32,
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
fn get_seeds(target_time_ms: u32) -> Vec<SeedGhost> {
    let elite = (target_time_ms as f64 * 0.55) as u32;
    let advanced = (target_time_ms as f64 * 0.65) as u32;
    let skilled_base = (target_time_ms as f64 * 0.70) as u32;
    let skilled_delta = (target_time_ms as f64 * 0.03) as u32;
    let mid_base = (target_time_ms as f64 * 0.85) as u32;
    let mid_delta = (target_time_ms as f64 * 0.03) as u32;
    let novice_base = (target_time_ms as f64 * 1.15) as u32;
    let novice_delta = (target_time_ms as f64 * 0.05) as u32;

    vec![
        // elite
        SeedGhost {
            name: "Blaze",
            time_ms: elite,
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
            time_ms: advanced,
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
            time_ms: skilled_base,
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
            name: "Dash",
            time_ms: skilled_base + skilled_delta,
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
            time_ms: skilled_base + skilled_delta * 2,
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
            time_ms: skilled_base + skilled_delta * 3,
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
            time_ms: mid_base,
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
            time_ms: mid_base + mid_delta,
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
            time_ms: mid_base + mid_delta * 2,
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
            time_ms: mid_base + mid_delta * 3,
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
            time_ms: mid_base + mid_delta * 4,
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
            time_ms: mid_base + mid_delta * 5,
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
            time_ms: mid_base + mid_delta * 6,
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
            time_ms: novice_base,
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
            time_ms: novice_base + novice_delta,
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
            time_ms: novice_base + novice_delta * 2,
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
            time_ms: novice_base + novice_delta * 3,
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
            time_ms: novice_base + novice_delta * 4,
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
            time_ms: novice_base + novice_delta * 5,
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
            time_ms: novice_base + novice_delta * 6,
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
            time_ms: novice_base + novice_delta * 7,
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
            time_ms: novice_base + novice_delta * 8,
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
            time_ms: novice_base + novice_delta * 9,
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
            name: "Shuffle",
            time_ms: novice_base + novice_delta * 10,
            vertices: &[
                (0.70, 0.0),
                (0.63, 0.35),
                (0.35, 0.63),
                (0.0, 0.70),
                (-0.35, 0.63),
                (-0.63, 0.35),
                (-0.70, 0.0),
                (-0.63, -0.35),
                (-0.35, -0.63),
                (0.0, -0.70),
                (0.35, -0.63),
                (0.63, -0.35),
            ],
        },
        SeedGhost {
            name: "Dawdle",
            time_ms: novice_base + novice_delta * 11,
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
    ]
}

/// Encode a seed ghost into the DRGH binary format (v2 with wheels[]).
fn encode_seed_blob(seed: &SeedGhost, track_id: u16, submitted_at: i64) -> Vec<u8> {
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
        + 1 // stroke_point_count
        + (stroke_points.len() * 6) // stroke_points (dx, dy, dt each variable)
        + 1 // checkpoint_count
        + (checkpoint_count as usize * 4); // checkpoints

    let mut buf = vec![0u8; total_size];

    // Magic "DRGH"
    buf[0..4].copy_from_slice(b"DRGH");
    buf[4] = PHYSICS_VERSION;
    buf[5..7].copy_from_slice(&track_id.to_le_bytes());
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

/// Parse track identifier from various input formats.
fn parse_track_identifier(input: &str) -> u16 {
    match input {
        "hills-01" | "track_1" | "1" => 1,
        "canyon-02" | "track_2" | "2" => 2,
        "dunes-03" | "track_3" | "3" => 3,
        other => {
            // Try to parse as integer first
            if let Ok(id) = other.parse::<u16>() {
                if (1..=3).contains(&id) {
                    id
                } else {
                    eprintln!("Error: track_id must be 1, 2, or 3, got {}", id);
                    process::exit(1);
                }
            } else {
                eprintln!("Error: unknown track '{}'. Use: hills-01, canyon-02, dunes-03, or track ID 1-3", other);
                process::exit(1);
            }
        }
    }
}

/// Get default target time for a track based on track metadata.
fn get_default_target_time(track_id: u16) -> u32 {
    match track_id {
        1 => 38_000, // hills-01 target
        2 => 50_000, // canyon-02 target
        3 => 55_000, // dunes-03 target
        _ => unreachable!(),
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().collect();

    if args.len() < 2 {
        eprintln!("Usage: {} --track <TRACK_ID|TRACK_NAME> [TARGET_TIME_MS]", args[0]);
        eprintln!("   OR:  {} <TRACK_ID|TRACK_NAME> [TARGET_TIME_MS]", args[0]);
        eprintln!("\nExamples:");
        eprintln!("  {} --track canyon-02 50000", args[0]);
        eprintln!("  {} --track dunes-03", args[0]);
        eprintln!("  {} --track_2 50000", args[0]);
        eprintln!("  {} --track_3", args[0]);
        eprintln!("  {} 2 50000            (legacy positional format)", args[0]);
        eprintln!("  (generates 25 seeds for the specified track)");
        process::exit(1);
    }

    // Enhanced argument parsing supporting both --track flag and positional arguments
    let (track_id, target_time_ms) = if args[1].starts_with("--track") {
        // Handle --track format (supports both --track canyon-02 and --track_2)
        let track_value = if args[1].starts_with("--track_") {
            // --track_2 or --track_3 format (no space)
            &args[1][8..] // Extract after --track_
        } else if args[1].starts_with("--track=") {
            // --track=canyon-02 format
            &args[1][7..]
        } else if args[1] == "--track" && args.len() >= 3 {
            // --track 2 format (space-separated)
            &args[2]
        } else {
            eprintln!("Error: --track requires a track identifier");
            eprintln!("Use: --track canyon-02, --track dunes-03, --track_2, --track_3");
            process::exit(1);
        };

        let track_id = parse_track_identifier(track_value);

        // Find the positional index for target time
        let target_time_ms = if args.len() > 2 {
            // Check if the last argument is a number (target time)
            let last_arg = &args[args.len() - 1];
            if last_arg.chars().all(|c| c.is_ascii_digit()) {
                last_arg.parse()
                    .map_err(|_| format!("Invalid target_time_ms '{}': must be an integer", last_arg))?
            } else {
                get_default_target_time(track_id)
            }
        } else {
            get_default_target_time(track_id)
        };

        (track_id, target_time_ms)
    } else {
        // Legacy positional argument format
        let track_id = parse_track_identifier(&args[1]);
        let target_time_ms = if args.len() >= 3 {
            args[2].parse()
                .map_err(|_| format!("Invalid target_time_ms '{}': must be an integer", args[2]))?
        } else {
            get_default_target_time(track_id)
        };
        (track_id, target_time_ms)
    };

    println!("Generating seed ghost blob files for track {}...", track_id);
    println!(
        "Target time: {}ms ({}s)",
        target_time_ms,
        target_time_ms / 1000
    );

    let workspace_root = std::env::current_dir()?;
    let seeds_dir = workspace_root
        .join("seeds")
        .join(format!("track_{}", track_id));

    // Create output directory
    fs::create_dir_all(&seeds_dir)?;

    let seeds = get_seeds(target_time_ms);
    let now_millis = chrono::Utc::now().timestamp_millis();

    for (i, seed) in seeds.iter().enumerate() {
        let blob = encode_seed_blob(seed, track_id, now_millis - (seeds.len() - i) as i64 * 1000);
        let filename = format!("seed-{:03}.blob", i);
        let filepath = seeds_dir.join(&filename);

        fs::write(&filepath, blob)?;

        println!("  Wrote {}: {} ({})", filename, seed.name, seed.time_ms);
    }

    println!(
        "\nGenerated {} seed ghost blob files in {:?}",
        seeds.len(),
        seeds_dir
    );
    println!("\nBucket distribution:");
    println!("  - elite    (pr ≤ 0.01):  1 ghost");
    println!("  - advanced (pr ≤ 0.05):  1 ghost");
    println!("  - skilled  (pr ≤ 0.20):  4 ghosts");
    println!("  - mid      (pr ≤ 0.50):  7 ghosts");
    println!("  - novice   (pr >  0.50): 12 ghosts");

    Ok(())
}
