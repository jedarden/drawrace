//! Test script to verify engine-core WASM exports
//!
//! Run with: cargo run --bin test-wasm

use std::env;
use std::fs;
use std::path::Path;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().collect();
    let wasm_path = args.get(1).map(|s| s.as_str()).unwrap_or(
        "packages/engine-core/dist/engine-core.a5ea2332c68a74a4.wasm"
    );

    println!("Testing WASM module: {}", wasm_path);

    // Read WASM file
    let wasm_bytes = fs::read(wasm_path)?;
    println!("  File size: {} bytes", wasm_bytes.len());

    // Verify WASM magic number
    assert_eq!(&wasm_bytes[0..4], b"\x00\x61\x73\x6d", "Invalid WASM magic");
    println!("  ✓ WASM magic number valid");

    // Verify WASM version
    assert_eq!(&wasm_bytes[4..8], b"\x01\x00\x00\x00", "Invalid WASM version");
    println!("  ✓ WASM version valid");

    // Read and parse metadata manually
    let metadata_path = Path::new(wasm_path).parent()
        .unwrap()
        .join("engine-core.wasm.json");
    let metadata_json = fs::read_to_string(metadata_path)?;

    // Simple regex extraction for physicsVersion and contentHash
    let physics_version: u64 = metadata_json
        .split("\"physicsVersion\":")
        .nth(1)
        .and_then(|s| s.split(',').next())
        .and_then(|s| s.trim().parse().ok())
        .ok_or("Missing physicsVersion")?;

    let content_hash: String = metadata_json
        .split("\"contentHash\":")
        .nth(1)
        .and_then(|s| s.split('"').nth(1))
        .ok_or("Missing contentHash")?
        .to_string();

    println!("  Physics version: {}", physics_version);
    println!("  Content hash: {}", content_hash);

    // Note: Full WASM execution test requires wasmtime crate
    // For now we just verify the binary structure
    println!("\n✓ WASM module structure valid");
    println!("  (Full export testing requires wasmtime runtime)");

    Ok(())
}
