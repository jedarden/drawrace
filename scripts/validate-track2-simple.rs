#!/usr/bin/env rust-script
//! Simple validation for track 2 seed ghosts

use std::fs;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("Validating track 2 seed ghosts...");

    let seed_dir = std::path::Path::new("seeds/track_2");
    if !seed_dir.exists() {
        panic!("Seed directory does not exist");
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
                if validate_blob(&filename, &blob_bytes) {
                    valid_count += 1;
                } else {
                    invalid_count += 1;
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
        std::process::exit(1);
    }

    Ok(())
}

fn validate_blob(filename: &std::ffi::OsString, blob: &[u8]) -> bool {
    // Check minimum size
    if blob.len() < 50 {
        println!("✗ {:?}: Too small ({} bytes)", filename, blob.len());
        return false;
    }

    // Check magic number
    let magic = &blob[0..4];
    if magic != b"DRGH" {
        println!("✗ {:?}: Invalid magic number", filename);
        return false;
    }

    // Check version
    let version = blob[4];
    println!("{:?}: version={}, track_id=2", filename.to_string_lossy(), version);

    // Check track_id (bytes 5-6, little endian u16)
    let track_id = u16::from_le_bytes([blob[5], blob[6]]);
    if track_id != 2 {
        println!("  WARNING: track_id is {}, expected 2", track_id);
        return false;
    }

    // Check flags
    let flags = blob[7];
    if flags != 0 {
        println!("  WARNING: flags is {}, expected 0", flags);
    }

    // Check finish_time_ms (bytes 8-11)
    let finish_time_ms = u32::from_le_bytes([blob[8], blob[9], blob[10], blob[11]]);
    if finish_time_ms == 0 || finish_time_ms > 180_000 {
        println!("  WARNING: finish_time_ms {} is suspicious", finish_time_ms);
        return false;
    }

    // Extract wheel_count (byte 36)
    let wheel_count = blob[36];
    if wheel_count < 1 || wheel_count > 21 {
        println!("  ERROR: wheel_count {} is out of range [1,21]", wheel_count);
        return false;
    }

    let mut offset = 37; // After wheel_count byte
    let mut prev_swap_tick = 0u32;

    // Parse each wheel
    for wheel_idx in 0..wheel_count {
        if offset + 5 > blob.len() {
            println!("  ERROR: Not enough data for wheel {} header", wheel_idx);
            return false;
        }

        let swap_tick = u32::from_le_bytes([
            blob[offset],
            blob[offset + 1],
            blob[offset + 2],
            blob[offset + 3]
        ]);

        let vertex_count = blob[offset + 4];

        // Check swap_tick ordering
        if wheel_idx > 0 && swap_tick <= prev_swap_tick {
            println!("  ERROR: swap_tick {} is not strictly increasing", swap_tick);
            return false;
        }

        // Check vertex count range
        if vertex_count < 8 || vertex_count > 32 {
            println!("  ERROR: vertex_count {} is out of range [8,32]", vertex_count);
            return false;
        }

        // Check we have enough data for vertices
        let vertex_data_size = vertex_count as usize * 4; // 2 i16 per vertex
        if offset + 5 + vertex_data_size > blob.len() {
            println!("  ERROR: Not enough data for {} vertices", vertex_count);
            return false;
        }

        println!("  Wheel {}: swap_tick={}, vertices={}", wheel_idx, swap_tick, vertex_count);

        offset += 5 + vertex_data_size;
        prev_swap_tick = swap_tick;
    }

    println!("✓ {:?}: size={} bytes, version={}, track_id={}, wheels={}, time={}ms",
             filename.to_string_lossy(), blob.len(), version, track_id, wheel_count, finish_time_ms);

    true
}
