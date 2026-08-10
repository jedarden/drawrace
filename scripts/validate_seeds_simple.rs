//! Simple validation script for track 2 seed ghosts
use std::fs;
use std::path::Path;

fn main() {
    println!("Validating track 2 seed ghosts...");

    let track_dir = Path::new("seeds/track_2");
    if !track_dir.exists() {
        eprintln!("Seed directory not found");
        std::process::exit(1);
    }

    let mut valid_count = 0;
    let mut invalid_count = 0;

    let entries: Vec<_> = fs::read_dir(track_dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map(|ext| ext == "blob").unwrap_or(false))
        .collect();

    for entry in entries {
        let path = entry.path();
        let filename = path.file_name().unwrap().to_string_lossy();

        match fs::read(&path) {
            Ok(bytes) => {
                // Check magic number
                if bytes.len() < 4 {
                    println!("✗ {}: Too short ({} bytes)", filename, bytes.len());
                    invalid_count += 1;
                    continue;
                }

                let magic = &bytes[0..4];
                if magic != b"DRGH" {
                    println!("✗ {}: Invalid magic", filename);
                    invalid_count += 1;
                    continue;
                }

                // Extract header fields
                if bytes.len() < 36 {
                    println!("✗ {}: Header incomplete ({} bytes)", filename, bytes.len());
                    invalid_count += 1;
                    continue;
                }

                let version = bytes[4];
                let track_id = u16::from_le_bytes([bytes[5], bytes[6]]);
                let time_ms = u32::from_le_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]);

                println!("✓ {}: version={}, track={}, time_ms={}, size={} bytes",
                    filename, version, track_id, time_ms, bytes.len());

                if track_id != 2 {
                    println!("  WARNING: track_id is {}, expected 2", track_id);
                }

                valid_count += 1;
            }
            Err(e) => {
                println!("✗ {}: Read error: {}", filename, e);
                invalid_count += 1;
            }
        }
    }

    println!("\nTotal: {} valid, {} invalid", valid_count, invalid_count);

    if invalid_count > 0 {
        std::process::exit(1);
    }
}