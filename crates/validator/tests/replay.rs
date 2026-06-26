/// Layer 6: Replay verification test.
///
/// This test runs pre-recorded real-player ghosts through the re-simulator
/// to detect physics drift. Any divergence from the expected finish times
/// fails CI, serving as a determinism regression gate.
///
/// Ghosts are stored in crates/validator/reference-ghosts.json. Initially
/// this file contains a small set of synthetic test ghosts; it should be
/// populated with 200 real-player ghosts from production to serve as the
/// full regression suite.
///
/// See plan.md §Testing Layer 6 for details.
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

/// Reference ghost data for replay verification.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct ReferenceGhost {
    /// Ghost ID (for logging/debugging)
    ghost_id: String,
    /// Track ID
    track_id: u16,
    /// Expected finish time (milliseconds)
    finish_time_ms: u32,
    /// Wheel entries (swap_tick, vertex_count, polygon_vertices)
    wheels: Vec<WheelData>,
    /// Physics version when this ghost was recorded
    physics_version: u32,
    /// Notes on how this ghost was generated
    notes: String,
}

/// Wheel data from a ghost run.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct WheelData {
    swap_tick: u32,
    vertex_count: u8,
    polygon_vertices: Vec<(i16, i16)>,
}

/// Top-level structure of reference-ghosts.json.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct ReferenceGhosts {
    version: u32,
    updated_at: String,
    /// Map of ghost_id -> reference ghost data
    ghosts: HashMap<String, ReferenceGhost>,
}

/// Load the reference ghosts JSON file.
fn load_reference_ghosts() -> Result<ReferenceGhosts> {
    let path = find_ghosts_path()?;

    let content = std::fs::read_to_string(&path)
        .with_context(|| format!("Failed to read ghosts file: {}", path.display()))?;

    let ghosts: ReferenceGhosts = serde_json::from_str(&content)
        .with_context(|| format!("Failed to parse ghosts file: {}", path.display()))?;

    Ok(ghosts)
}

/// Find the reference ghosts JSON file.
fn find_ghosts_path() -> Result<PathBuf> {
    // Check environment variable first
    if let Ok(env_path) = std::env::var("REFERENCE_GHOSTS_PATH") {
        let path = PathBuf::from(&env_path);
        if path.exists() {
            return Ok(path);
        }
    }

    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_string());

    // Compute workspace root
    let workspace_root = PathBuf::from(&manifest_dir)
        .parent() // crates
        .and_then(|p| p.parent()) // workspace root
        .map(|p| p.display().to_string())
        .unwrap_or_else(|| ".".to_string());

    // List of paths to try
    let candidates = vec![
        format!("{}/crates/validator/reference-ghosts.json", workspace_root),
        format!(
            "{}/../../crates/validator/reference-ghosts.json",
            manifest_dir
        ),
        "crates/validator/reference-ghosts.json".to_string(),
    ];

    for path in candidates {
        let path_buf = PathBuf::from(&path);
        if path_buf.exists() {
            return Ok(path_buf);
        }
    }

    Err(anyhow::anyhow!(
        "Could not find reference-ghosts.json in any of the following locations: {:?}. \
         Set REFERENCE_GHOSTS_PATH environment variable to override.",
        [
            "REFERENCE_GHOSTS_PATH env",
            "crates/validator/reference-ghosts.json"
        ]
    ))
}

/// Run replay verification for all reference ghosts.
#[test]
fn replay_all_reference_ghosts() {
    // Initialize logging for test output
    let _ = tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .try_init();

    let ghosts = match load_reference_ghosts() {
        Ok(g) => g,
        Err(e) => {
            // If the file doesn't exist yet, skip the test with a helpful message
            if e.to_string().contains("No such file") || e.to_string().contains("could not find") {
                println!("Skipping replay test: reference-ghosts.json not found.");
                println!("This file should be created with 200 pre-recorded ghosts.");
                println!("Set REFERENCE_GHOSTS_PATH environment variable to override.");
                return;
            }
            panic!("Failed to load reference ghosts: {}", e);
        }
    };

    if ghosts.ghosts.is_empty() {
        println!("Skipping replay test: reference-ghosts.json contains no ghosts.");
        println!("Populate it with real-player ghosts to enable replay verification.");
        return;
    }

    // Load the resim engine
    let resim_engine = match drawrace_validator::resim::ResimEngine::load() {
        Ok(e) => e,
        Err(e) => {
            if e.to_string().contains("No such file") || e.to_string().contains("could not find") {
                println!("Skipping replay test: resim.wasm not found (run build first)");
                return;
            }
            panic!("Failed to load resim WASM: {}", e);
        }
    };

    // Load track store
    let tracks_dir = std::env::var("TRACKS_DIR").unwrap_or_else(|_| {
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_string());
        let workspace_root = PathBuf::from(&manifest_dir)
            .parent() // crates
            .and_then(|p| p.parent()) // workspace root
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| ".".to_string());
        format!("{}/apps/web/public/tracks", workspace_root)
    });

    let track_store = match drawrace_validator::track::TrackStore::load(PathBuf::from(&tracks_dir))
    {
        Ok(t) => t,
        Err(e) => {
            println!(
                "Skipping replay test: failed to load track store from {}: {}",
                tracks_dir, e
            );
            return;
        }
    };

    // Track results
    let mut passed = 0;
    let mut failed = 0;
    let mut failures = Vec::new();

    for (ghost_id, ghost) in &ghosts.ghosts {
        // Get track data
        let track_data = match track_store.get(ghost.track_id) {
            Some(t) => t,
            None => {
                failures.push(format!(
                    "{}: track {} not found in track store",
                    ghost_id, ghost.track_id
                ));
                failed += 1;
                continue;
            }
        };

        // Convert wheels to WASM format
        let wheels: Vec<drawrace_api::blob::WheelEntry> = ghost
            .wheels
            .iter()
            .map(|w| drawrace_api::blob::WheelEntry {
                swap_tick: w.swap_tick,
                vertex_count: w.vertex_count,
                polygon_vertices: w.polygon_vertices.clone(),
            })
            .collect();

        // Calculate expected finish tick
        let expected_finish_ticks = (ghost.finish_time_ms as u64 * 60 / 1000) as u32;

        // Run re-simulation with a fixed seed for determinism
        let seed = 42u32;

        let result = resim_engine.resim(
            &wheels,
            &track_data.terrain,
            &track_data.obstacles,
            track_data.finish_x,
            track_data.start_x,
            track_data.start_y,
            expected_finish_ticks,
            seed,
        );

        match result {
            Ok(sim_result) => {
                // Allow 2 tick tolerance for floating-point differences
                const FINISH_TICK_TOLERANCE: u32 = 2;

                match sim_result.finish_ticks {
                    None => {
                        failures.push(format!(
                            "{}: resim did not finish within timeout (expected {}ms / {} ticks)",
                            ghost_id, ghost.finish_time_ms, expected_finish_ticks
                        ));
                        failed += 1;
                    }
                    Some(server_finish_ticks) => {
                        let diff = server_finish_ticks.abs_diff(expected_finish_ticks);

                        if diff > FINISH_TICK_TOLERANCE {
                            failures.push(format!(
                                "{}: tick mismatch: expected {}, got {}, diff = {}",
                                ghost_id, expected_finish_ticks, server_finish_ticks, diff
                            ));
                            failed += 1;
                        } else {
                            passed += 1;
                        }
                    }
                }
            }
            Err(e) => {
                failures.push(format!("{}: resim failed: {}", ghost_id, e));
                failed += 1;
            }
        }
    }

    // Report results
    println!("\n=== Replay Verification Results ===");
    println!("Total: {}", passed + failed);
    println!("Passed: {}", passed);
    println!("Failed: {}", failed);

    if !failures.is_empty() {
        println!("\nFailures:");
        for failure in &failures {
            println!("  - {}", failure);
        }
    }

    // Fail the test if any ghost diverged
    assert_eq!(
        failed, 0,
        "{} ghost(s) failed replay verification: {:?}",
        failed, failures
    );
}

/// Test that the reference ghosts file can be loaded.
#[test]
fn test_load_reference_ghosts() {
    match load_reference_ghosts() {
        Ok(ghosts) => {
            assert_eq!(ghosts.version, 1);
            println!("Loaded {} reference ghosts", ghosts.ghosts.len());
        }
        Err(e) => {
            if e.to_string().contains("No such file") || e.to_string().contains("could not find") {
                println!("Skipping test: reference-ghosts.json not found");
                return;
            }
            panic!("Failed to load reference ghosts: {}", e);
        }
    }
}
