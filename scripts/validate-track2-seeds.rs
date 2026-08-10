#!/usr/bin/env cargo-script
//! Validate existing track 2 seed ghosts

use anyhow::Result;
use drawrace_api::blob::{BlobHeader, GhostBlob};
use std::fs;

const TRACK_2_DIR: &str = "seeds/track_2";

fn main() -> Result<()> {
    println!("Validating track 2 seed ghosts...");

    let seed_dir = std::path::Path::new(TRACK_2_DIR);
    if !seed_dir.exists() {
        anyhow::bail!("Seed directory {} not found", TRACK_2_DIR);
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

    for entry in blob_files {
        let filename = entry.file_name();
        let filepath = entry.path();

        match fs::read(&filepath) {
            Ok(blob_bytes) => {
                match GhostBlob::parse(&blob_bytes) {
                    Ok(blob) => {
                        let header = &blob.header;
                        println!(
                            "✓ {}: version={}, track_id={}, time_ms={}, wheels={}, vertices={}",
                            filename.to_string_lossy(),
                            header.version,
                            header.track_id,
                            header.finish_time_ms,
                            blob.wheel_count,
                            blob.wheels.iter().map(|w| w.vertex_count as usize).sum::<usize>()
                        );
                        valid_count += 1;

                        // Validate track_id is correct
                        if header.track_id != 2 {
                            println!("  WARNING: track_id is {}, expected 2", header.track_id);
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