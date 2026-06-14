/// Re-simulation engine using WASM engine-core.
///
/// This module loads the resim.wasm module and provides a high-level
/// interface for running re-simulations with wheel swaps, track data,
/// and reading deterministic results.
use anyhow::{Context, Result};
use drawrace_api::blob::WheelEntry;
use std::path::PathBuf;
use wasmtime::{Engine, Linker, Module, Store};

use crate::wasm_abi::{self, Obstacle, SimResult, SimState, TOTAL_MEMORY_SIZE};

/// WASM re-simulation engine.
pub struct ResimEngine {
    engine: Engine,
    module: Module,
    /// The physics version reported by the WASM module
    pub physics_version: u32,
}

impl ResimEngine {
    /// Load the resim.wasm module.
    pub fn load() -> Result<Self> {
        let wasm_path = Self::find_resim_path()?;

        let wasm_bytes = std::fs::read(&wasm_path)
            .with_context(|| format!("Failed to read WASM file: {}", wasm_path.display()))?;

        let config = wasmtime::Config::new();

        let engine = Engine::new(&config).context("Failed to create WASM engine")?;

        let module = Module::new(&engine, &wasm_bytes).map_err(|e| {
            anyhow::anyhow!(
                "Failed to load WASM module from {}: WASM size={} bytes. Error: {}",
                wasm_path.display(),
                wasm_bytes.len(),
                e
            )
        })?;

        // Verify the module has the required exports
        let required_exports = vec![
            "physics_version",
            "wasm_validate",
            "resim_init",
            "resim_step",
            "resim_swap_wheel",
            "resim_is_finished",
            "resim_is_stuck",
            "resim_get_tick",
            "memory",
        ];

        let exports: Vec<&str> = module.exports().map(|e| e.name()).collect();
        for export in &required_exports {
            if !exports.contains(export) {
                anyhow::bail!("Required export '{}' not found in WASM module", export);
            }
        }

        // Get physics version
        let mut store = Store::new(&engine, ());
        let linker = Linker::new(&engine);
        let instance = linker
            .instantiate(&mut store, &module)
            .context("Failed to instantiate WASM module")?;

        let physics_version_func = instance
            .get_typed_func::<(), u32>(&mut store, "physics_version")
            .context("physics_version export not found")?;

        let physics_version = physics_version_func
            .call(&mut store, ())
            .context("physics_version call failed")?;

        Ok(Self {
            engine,
            module,
            physics_version,
        })
    }

    /// Find the resim.wasm file.
    fn find_resim_path() -> Result<PathBuf> {
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_string());

        // Compute workspace root from manifest_dir (crates/validator -> workspace root)
        let workspace_root = PathBuf::from(&manifest_dir)
            .parent() // crates
            .and_then(|p| p.parent()) // workspace root
            .map(|p| p.display().to_string())
            .unwrap_or(".".to_string());

        // Check for environment variable override
        if let Ok(env_path) = std::env::var("RESIM_WASM_PATH") {
            let wasm_path = PathBuf::from(&env_path);
            if wasm_path.exists() {
                return Ok(wasm_path);
            }
        }

        // List of paths to try, in order
        let candidates = vec![
            // Prefer resim.wasm (rebuilt with Python script)
            format!("{}/packages/engine-core/dist/resim.wasm", workspace_root),
            // Fallback to resim-test.wasm
            format!(
                "{}/packages/engine-core/dist/resim-test.wasm",
                workspace_root
            ),
            // Standard workspace layout
            format!(
                "{}/../../packages/engine-core/dist/resim.wasm",
                manifest_dir
            ),
            format!(
                "{}/../../packages/engine-core/dist/resim-test.wasm",
                manifest_dir
            ),
            // From current working directory
            "packages/engine-core/dist/resim.wasm".to_string(),
            "packages/engine-core/dist/resim-test.wasm".to_string(),
        ];

        for path in &candidates {
            let path_buf = PathBuf::from(&path);
            if path_buf.exists() {
                return Ok(path_buf);
            }
        }

        Err(anyhow::anyhow!(
            "Could not find resim.wasm in any of the following locations: {:?}. \
             Set RESIM_WASM_PATH environment variable to override.",
            candidates
        ))
    }

    /// Run a re-simulation with the given parameters.
    pub fn resim(
        &self,
        wheels: &[WheelEntry],
        terrain: &[(f32, f32)],
        obstacles: &[Obstacle],
        finish_x: f32,
        start_x: f32,
        start_y: f32,
        claimed_finish: u32,
        seed: u32,
    ) -> Result<SimResult> {
        let mut store = Store::new(&self.engine, ());
        let linker = Linker::new(&self.engine);
        let instance = linker
            .instantiate(&mut store, &self.module)
            .context("Failed to instantiate WASM module")?;

        // Get exported memory
        let memory = instance
            .get_memory(&mut store, "memory")
            .context("memory export not found")?;

        // Ensure memory is large enough
        let memory_size = memory.size(&store) * 65536; // pages to bytes
        let required_size = TOTAL_MEMORY_SIZE as u64;
        if memory_size < required_size {
            anyhow::bail!(
                "WASM memory too small: {} bytes, required at least {} bytes",
                memory_size,
                required_size
            );
        }

        // Initialize memory with simulation data
        wasm_abi::init_memory(
            &memory,
            &mut store,
            wheels,
            terrain,
            obstacles,
            finish_x,
            start_x,
            start_y,
            claimed_finish,
            seed,
        )?;

        // Get WASM functions
        let resim_init = instance
            .get_typed_func::<(), u32>(&mut store, "resim_init")
            .context("resim_init export not found")?;

        let resim_step = instance
            .get_typed_func::<(), u32>(&mut store, "resim_step")
            .context("resim_step export not found")?;

        // Initialize simulation
        let init_result = resim_init.call(&mut store, ())?;
        if init_result != 1 {
            anyhow::bail!("resim_init failed: returned {}", init_result);
        }

        // Run simulation - TypeScript handles wheel swaps automatically during resim_step()
        // based on the swap_tick values in the wheel descriptors written to memory
        let max_ticks = claimed_finish.saturating_mul(2).max(90 * 60);
        loop {
            // Step the simulation (swaps are applied automatically during the step)
            let step_result = resim_step.call(&mut store, ())?;
            if step_result == 0 {
                // Simulation finished
                break;
            }

            // Safety check: prevent infinite loops
            let current_tick = wasm_abi::read_u32(
                &memory,
                &mut store,
                wasm_abi::STATE_OFFSET + wasm_abi::state::SIM_TICK,
            )?;
            if current_tick > max_ticks {
                anyhow::bail!("Simulation exceeded maximum tick count: {}", current_tick);
            }
        }

        // Read result
        let result = wasm_abi::read_result(&memory, &mut store)?;

        Ok(result)
    }

    /// Run a re-simulation and return the full simulation state.
    pub fn resim_with_state(
        &self,
        wheels: &[WheelEntry],
        terrain: &[(f32, f32)],
        obstacles: &[Obstacle],
        finish_x: f32,
        start_x: f32,
        start_y: f32,
        claimed_finish: u32,
        seed: u32,
    ) -> Result<(SimResult, SimState)> {
        let mut store = Store::new(&self.engine, ());
        let linker = Linker::new(&self.engine);
        let instance = linker
            .instantiate(&mut store, &self.module)
            .context("Failed to instantiate WASM module")?;

        // Get exported memory
        let memory = instance
            .get_memory(&mut store, "memory")
            .context("memory export not found")?;

        // Ensure memory is large enough
        let memory_size = memory.size(&store) * 65536;
        let required_size = TOTAL_MEMORY_SIZE as u64;
        if memory_size < required_size {
            anyhow::bail!(
                "WASM memory too small: {} bytes, required at least {} bytes",
                memory_size,
                required_size
            );
        }

        // Initialize memory with simulation data
        wasm_abi::init_memory(
            &memory,
            &mut store,
            wheels,
            terrain,
            obstacles,
            finish_x,
            start_x,
            start_y,
            claimed_finish,
            seed,
        )?;

        // Get WASM functions
        let resim_init = instance
            .get_typed_func::<(), u32>(&mut store, "resim_init")
            .context("resim_init export not found")?;

        let resim_step = instance
            .get_typed_func::<(), u32>(&mut store, "resim_step")
            .context("resim_step export not found")?;

        // Initialize simulation
        let init_result = resim_init.call(&mut store, ())?;
        if init_result != 1 {
            anyhow::bail!("resim_init failed: returned {}", init_result);
        }

        // Run simulation - TypeScript handles wheel swaps automatically during resim_step()
        // based on the swap_tick values in the wheel descriptors written to memory
        let max_ticks = claimed_finish.saturating_mul(2).max(90 * 60);
        loop {
            // Step the simulation (swaps are applied automatically during the step)
            let step_result = resim_step.call(&mut store, ())?;
            if step_result == 0 {
                break;
            }

            // Safety check: prevent infinite loops
            let current_tick = wasm_abi::read_u32(
                &memory,
                &mut store,
                wasm_abi::STATE_OFFSET + wasm_abi::state::SIM_TICK,
            )?;
            if current_tick > max_ticks {
                anyhow::bail!("Simulation exceeded maximum tick count: {}", current_tick);
            }
        }

        // Read result and state
        let result = wasm_abi::read_result(&memory, &mut store)?;
        let state = wasm_abi::read_state(&memory, &mut store)?;

        Ok((result, state))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_resim_wasm() {
        match ResimEngine::load() {
            Ok(engine) => {
                assert_eq!(engine.physics_version, 4);
            }
            Err(e) => {
                if e.to_string().contains("No such file")
                    || e.to_string().contains("could not find")
                {
                    println!("Skipping test: resim.wasm not found (run build first)");
                    return;
                }
                panic!("Failed to load resim WASM: {}", e);
            }
        }
    }

    #[test]
    fn test_simple_resim() {
        let engine = match ResimEngine::load() {
            Ok(e) => e,
            Err(e) => {
                if e.to_string().contains("No such file")
                    || e.to_string().contains("could not find")
                {
                    println!("Skipping test: resim.wasm not found (run build first)");
                    return;
                }
                panic!("Failed to load resim WASM: {}", e);
            }
        };

        // Simple test case: straight track, one wheel
        // Using realistic values for a short race
        let wheels = vec![WheelEntry {
            swap_tick: 0,
            vertex_count: 4,
            polygon_vertices: vec![(-50, -50), (50, -50), (50, 50), (-50, 50)],
        }];

        // For a square wheel (4 vertices), velocity_factor = 0.50, target_velocity = 6.35 * 0.50 = 3.175 m/s
        // For a 10-second race (600 ticks), distance = 3.175 * 10 = 31.75 meters
        let distance = 40.0; // meters
        let race_time_seconds = 15.0; // seconds
        let claimed_finish = (race_time_seconds * 60.0) as u32; // ticks at 60fps

        let terrain = vec![
            (0.0, 500.0),
            (distance + 20.0, 500.0), // Extra space beyond finish line
        ];

        let obstacles: Vec<Obstacle> = vec![];

        let result = engine.resim(
            &wheels,
            &terrain,
            &obstacles,
            distance, // finish_x
            5.0,      // start_x
            498.0,    // start_y (terrain_y - wheel_radius - 1.5)
            claimed_finish,
            42, // seed
        );

        assert!(result.is_ok(), "resim failed: {:?}", result.err());
        let sim_result = result.unwrap();

        // For Phase 2 simplified physics, we expect the simulation to finish
        assert!(
            sim_result.finish_ticks.is_some(),
            "Expected finish_ticks to be set, got None"
        );

        let finish_ticks = sim_result.finish_ticks.unwrap();
        // With square wheel at 3.175 m/s, 40 meters takes about 12.6 seconds (756 ticks)
        // The simulation should finish and return a tick count close to expected
        assert!(
            finish_ticks > 0 && finish_ticks < claimed_finish * 2,
            "Expected reasonable finish_ticks, got {} (claimed: {})",
            finish_ticks,
            claimed_finish
        );
    }
}
