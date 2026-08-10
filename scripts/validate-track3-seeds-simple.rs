#!/usr/bin/env -S cargo run --bin drawrace-validator --
//! Validate existing track 3 seed ghosts - just check blob parsing

use anyhow::Result;
use drawrace_api::blob::{BlobHeader, GhostBlob};
use std::fs;

fn main() -> Result<()> {
    println!("Validating track 3 (dunes-03) seed ghosts...");

    let seed_dir = "seeds/track_3";
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

    for entry in blob_files {
        let filename = entry.file_name();
        let filepath = entry.path();

        match fs::read(&filepath) {
            Ok(blob_bytes) => {
                match GhostBlob::parse(&blob_bytes) {
                    Ok(blob) => {
                        let header = &blob.header;
                        let time_sec = header.finish_time_ms as f64 / 1000.0;

                        // Basic validation checks
                        let is_valid = header.track_id == 3
                            && header.finish_time_ms > 20_000
                            && header.finish_time_ms < 120_000
                            && blob.wheel_count > 0
                            && blob.wheel_count <= 21;

                        if is_valid {
                            println!("✓ {}: track_id={}, time={:.1}s, wheels={}, vertices={}",
                                filename.to_string_lossy(),
                                header.track_id,
                                time_sec,
                                blob.wheel_count,
                                blob.wheels.iter().map(|w| w.vertex_count as usize).sum::<usize>()
                            );
                            valid_count += 1;
                        } else {
                            println!("✗ {}: Invalid structure", filename.to_string_lossy());
                            invalid_count += 1;
                        }
                    }
                    Err(e) => {
                        println!("✗ {}: Parse error - {}", filename.to_string_lossy(), e);
                        invalid_count += 1;
                    }
                }
            }
            Err(e) => {
                println!("✗ {}: Read error - {}", filename.to_string_lossy(), e);
                invalid_count += 1;
            }
        }
    }

    println!("\nValidation complete:");
    println!("  Valid:   {}", valid_count);
    println!("  Invalid: {}", invalid_count);

    if invalid_count > 0 {
        anyhow::bail!("Found {} invalid seed files", invalid_count);
    }

    Ok(())
}