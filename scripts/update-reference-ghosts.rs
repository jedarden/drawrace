#!/usr/bin/env cargo-script
//! Update reference-ghosts.json with actual WASM resim results.
//!
//! This script reads the current reference-ghosts.json, runs the WASM
//! resimulation for each ghost, and updates the finish_time_ms to the
//! actual result from the simulation.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WheelData {
    swap_tick: u32,
    vertex_count: u8,
    polygon_vertices: Vec<(i16, i16)>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ReferenceGhost {
    ghost_id: String,
    track_id: u16,
    finish_time_ms: u32,
    wheels: Vec<WheelData>,
    physics_version: u32,
    notes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ReferenceGhosts {
    version: u32,
    updated_at: String,
    ghosts: HashMap<String, ReferenceGhost>,
}

fn find_ghosts_path() -> Result<PathBuf> {
    let workspace_root = std::env::current_dir()?;

    let candidates = vec![
        workspace_root.join("crates/validator/reference-ghosts.json"),
        workspace_root.join("reference-ghosts.json"),
    ];

    for path in candidates {
        if path.exists() {
            return Ok(path);
        }
    }

    Err(anyhow::anyhow!("Could not find reference-ghosts.json"))
}

fn main() -> Result<()> {
    println!("Loading reference ghosts...");
    let ghosts_path = find_ghosts_path()?;
    let content = std::fs::read_to_string(&ghosts_path)?;
    let mut ghosts: ReferenceGhosts = serde_json::from_str(&content)?;

    println!("Loaded {} reference ghosts", ghosts.ghosts.len());

    // Find resim.wasm path
    let resim_path = {
        let workspace_root = std::env::current_dir()?;
        let candidates = vec![
            workspace_root.join("packages/engine-core/dist/resim.wasm"),
            workspace_root.join("packages/engine-core/dist/resim-test.wasm"),
        ];

        let mut found = None;
        for path in candidates {
            if path.exists() {
                found = Some(path);
                break;
            }
        }
        found.ok_or_else(|| anyhow::anyhow!("Could not find resim.wasm"))?
    };

    println!("Using resim.wasm from: {:?}", resim_path);

    // Load WASM
    let wasm_bytes = std::fs::read(&resim_path)?;
    let config = wasmtime::Config::new();
    let engine = wasmtime::Engine::new(&config)?;
    let module = wasmtime::Module::new(&engine, &wasm_bytes)?;

    // Load track store
    let tracks_dir = std::env::current_dir()?
        .join("apps/web/public/tracks");
    let track_store = drawrace_validator::track::TrackStore::load(tracks_dir)?;

    println!("Processing ghosts...");
    let mut updated = 0;

    for (ghost_id, ghost) in ghosts.ghosts.iter_mut() {
        // Get track data
        let track_data = match track_store.get(ghost.track_id) {
            Some(t) => t,
            None => {
                println!("  {}: track {} not found, skipping", ghost_id, ghost.track_id);
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

        // Run resim - use a generous claimed_finish to get the actual result
        let claimed_finish = 10000u32; // 166 seconds, generous timeout
        let seed = 42u32;

        let mut store = wasmtime::Store::new(&engine, ());
        let linker = wasmtime::Linker::new(&engine);
        let instance = linker
            .instantiate(&mut store, &module)
            .context("Failed to instantiate WASM")?;

        let memory = instance
            .get_memory(&mut store, "memory")
            .context("memory export not found")?;

        // Initialize memory
        drawrace_validator::wasm_abi::init_memory(
            &memory,
            &mut store,
            &wheels,
            &track_data.terrain,
            &track_data.obstacles,
            track_data.finish_x,
            track_data.start_x,
            track_data.start_y,
            claimed_finish,
            seed,
        )?;

        // Run simulation
        let resim_init = instance
            .get_typed_func::<(), u32>(&mut store, "resim_init")?;
        let resim_step = instance
            .get_typed_func::<(), u32>(&mut store, "resim_step")?;

        let init_result = resim_init.call(&mut store, ())?;
        if init_result != 1 {
            println!("  {}: resim_init failed", ghost_id);
            continue;
        }

        loop {
            let step_result = resim_step.call(&mut store, ())?;
            if step_result == 0 {
                break;
            }
        }

        // Read result
        let sim_result = drawrace_validator::wasm_abi::read_result(&memory, &mut store)?;

        if let Some(finish_ticks) = sim_result.finish_ticks {
            let finish_time_ms = (finish_ticks as u64 * 1000 / 60) as u32;

            if ghost.finish_time_ms != finish_time_ms {
                println!(
                    "  {}: {}ms -> {}ms ({} ticks)",
                    ghost_id, ghost.finish_time_ms, finish_time_ms, finish_ticks
                );
                ghost.finish_time_ms = finish_time_ms;
                updated += 1;
            }
        } else {
            println!("  {}: resim did not finish", ghost_id);
        }
    }

    println!("\nUpdated {} ghost(s)", updated);

    // Update timestamp
    ghosts.updated_at = chrono::Utc::now().to_rfc3339();

    // Write back
    let output = serde_json::to_string_pretty(&ghosts)?;
    std::fs::write(&ghosts_path, output)?;

    println!("Updated reference-ghosts.json");

    Ok(())
}
