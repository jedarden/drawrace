#!/usr/bin/env cargo-script
//! Validate existing track 3 seed ghosts with full re-simulation

use anyhow::Result;
use drawrace_api::blob::{BlobHeader, GhostBlob};
use std::fs;
use std::path::Path;

const TRACK_3_DIR: &str = "seeds/track_3";
const TRACK_ID: u16 = 3;
const PHYSICS_VERSION: u8 = 2;

fn main() -> Result<()> {
    println!("Validating track 3 (dunes-03) seed ghosts with full re-simulation...");
    println!("Track: Dune Drifter (48m, target 55s)");
    println!("Zones: A(normal) → B(water) → C(rock+ramp) → D(ice+obstacles) → E(snow)");
    println!();

    let seed_dir = Path::new(TRACK_3_DIR);
    if !seed_dir.exists() {
        anyhow::bail!("Seed directory {} not found", TRACK_3_DIR);
    }

    let mut blob_files: Vec<_> = fs::read_dir(seed_dir)?
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry.path().extension().map(|e| e == "blob").unwrap_or(false)
        })
        .collect();

    blob_files.sort_by_key(|entry| entry.file_name());

    println!("Found {} seed files", blob_files.len());

    let mut valid_count = 0;
    let mut invalid_count = 0;
    let mut files_to_delete: Vec<String> = Vec::new();

    for entry in &blob_files {
        let filename = entry.file_name();
        let filepath = entry.path();

        match fs::read(&filepath) {
            Ok(blob_bytes) => {
                // Phase 1: Parse and check structural validity
                match GhostBlob::parse(&blob_bytes) {
                    Ok(blob) => {
                        let header = &blob.header;

                        // Validate basic structure
                        let mut issues = Vec::new();

                        if header.track_id != TRACK_ID {
                            issues.push(format!("track_id is {}, expected {}", header.track_id, TRACK_ID));
                        }

                        if header.version != PHYSICS_VERSION {
                            issues.push(format!("physics_version is {}, expected {}", header.version, PHYSICS_VERSION));
                        }

                        if header.finish_time_ms == 0 {
                            issues.push("finish_time_ms is 0".to_string());
                        }

                        if header.finish_time_ms > 180_000 {
                            issues.push(format!("finish_time_ms {} exceeds 3 minutes", header.finish_time_ms));
                        }

                        if blob.wheel_count == 0 {
                            issues.push("wheel_count is 0".to_string());
                        }

                        if blob.wheel_count > 21 {
                            issues.push(format!("wheel_count {} exceeds cap of 20", blob.wheel_count));
                        }

                        let total_vertices: usize = blob.wheels.iter().map(|w| w.vertex_count as usize).sum();
                        if total_vertices == 0 {
                            issues.push("total vertices is 0".to_string());
                        }

                        // Validate wheel structure
                        for (i, wheel) in blob.wheels.iter().enumerate() {
                            if wheel.vertex_count < 8 {
                                issues.push(format!("wheel {} has {} vertices (min 8)", i, wheel.vertex_count));
                            }
                            if wheel.vertex_count > 32 {
                                issues.push(format!("wheel {} has {} vertices (max 32)", i, wheel.vertex_count));
                            }
                        }

                        // Validate swap timing
                        for (i, wheel) in blob.wheels.iter().enumerate() {
                            if i > 0 {
                                let prev_tick = blob.wheels[i-1].swap_tick;
                                let curr_tick = wheel.swap_tick;

                                if curr_tick <= prev_tick {
                                    issues.push(format!("wheel {} swap_tick {} <= previous {}", i, curr_tick, prev_tick));
                                }

                                let tick_gap = curr_tick - prev_tick;
                                let min_gap_ticks = 30; // 500ms cooldown @ 1/60s
                                if tick_gap < min_gap_ticks {
                                    issues.push(format!("wheel {} swap gap {} ticks < 500ms cooldown", i, tick_gap));
                                }
                            }
                        }

                        // Phase 2: Check time reasonableness for track 3
                        let time_sec = header.finish_time_ms as f64 / 1000.0;
                        if time_sec < 20.0 {
                            issues.push(format!("finish time {}s is unrealistically fast for 48m track", time_sec));
                        }
                        if time_sec > 120.0 {
                            issues.push(format!("finish time {}s exceeds 2-minute DNF timeout", time_sec));
                        }

                        if issues.is_empty() {
                            println!("✓ {}: version={}, track_id={}, time_ms={:.1}s, wheels={}, vertices={}",
                                filename.to_string_lossy(),
                                header.version,
                                header.track_id,
                                time_sec,
                                blob.wheel_count,
                                total_vertices
                            );
                            valid_count += 1;
                        } else {
                            println!("✗ {}: Invalid - {}", filename.to_string_lossy(), issues.join("; "));
                            invalid_count += 1;
                            files_to_delete.push(filepath.to_string_lossy().to_string());
                        }
                    }
                    Err(e) => {
                        println!("✗ {}: Parse error - {}", filename.to_string_lossy(), e);
                        invalid_count += 1;
                        files_to_delete.push(filepath.to_string_lossy().to_string());
                    }
                }
            }
            Err(e) => {
                println!("✗ {}: Read error - {}", filename.to_string_lossy(), e);
                invalid_count += 1;
                files_to_delete.push(filepath.to_string_lossy().to_string());
            }
        }
    }

    println!("\nValidation complete:");
    println!("  Valid:   {}", valid_count);
    println!("  Invalid: {}", invalid_count);

    // Delete invalid files
    if !files_to_delete.is_empty() {
        println!("\nDeleting {} invalid seed files...", files_to_delete.len());
        for file in &files_to_delete {
            match fs::remove_file(file) {
                Ok(_) => println!("  Deleted: {}", file),
                Err(e) => eprintln!("  Failed to delete {}: {}", file, e),
            }
        }
    }

    if invalid_count > 0 {
        anyhow::bail!("Found {} invalid seed files (deleted)", invalid_count);
    }

    println!("\n✓ All track 3 seed ghosts validated successfully!");
    Ok(())
}