/// WASM physics engine for live racing.
///
/// This module loads the resim.wasm module and provides incremental
/// stepping for real-time racing simulation. Each racer gets their
/// own WASM instance to track their position independently.
///
/// Per plan §Multiplayer & Backend 13:
/// - "The pod runs the same WASM physics module the client uses, at 30 Hz fixed step"
/// - "Each tick broadcasts {racer_id, x, y, angle, t} for 2–8 racers"
use anyhow::{Context, Result};
use drawrace_api::blob::WheelEntry;
use std::path::PathBuf;
use wasmtime::{Engine, Linker, Memory, Module, Store};

/// Physics engine wrapper for WASM simulation.
#[derive(Clone)]
pub struct PhysicsEngine {
    engine: Engine,
    module: Module,
    /// The physics version reported by the WASM module
    pub physics_version: u32,
}

impl PhysicsEngine {
    /// Load the resim.wasm module.
    pub fn load() -> Result<Self> {
        let wasm_path = Self::find_resim_path()?;

        let wasm_bytes = std::fs::read(&wasm_path)
            .with_context(|| format!("Failed to read WASM file: {}", wasm_path.display()))?;

        let mut config = wasmtime::Config::new();
        config.wasm_simd(true);
        config.wasm_multi_memory(true);

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

        tracing::info!(
            physics_version,
            wasm_path = %wasm_path.display(),
            "Loaded WASM physics engine"
        );

        Ok(Self {
            engine,
            module,
            physics_version,
        })
    }

    /// Find the resim.wasm file.
    fn find_resim_path() -> Result<PathBuf> {
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_string());

        // Compute workspace root from manifest_dir (crates/live -> workspace root)
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

    /// Create a new racer simulation instance.
    ///
    /// Each racer gets their own WASM instance for independent state tracking.
    #[allow(clippy::too_many_arguments)]
    pub fn create_racer_sim(
        &self,
        wheels: Vec<WheelEntry>,
        terrain: &[(f32, f32)],
        obstacles: &[Obstacle],
        finish_x: f32,
        start_x: f32,
        start_y: f32,
        seed: u32,
    ) -> Result<RacerSim> {
        // Use a generous max_ticks for live racing (90 seconds at 60Hz)
        let max_ticks = 90 * 60;

        RacerSim::new(
            self.engine.clone(),
            self.module.clone(),
            wheels,
            terrain,
            obstacles,
            finish_x,
            start_x,
            start_y,
            max_ticks,
            seed,
        )
    }
}

/// Per-racer simulation state.
///
/// Each racer has their own WASM instance to track position independently.
pub struct RacerSim {
    _store: Store<()>,
    memory: Memory,
    resim_step: wasmtime::TypedFunc<(), i32>,
    current_tick: u32,
    finished: bool,
    start_x: f32,
    start_y: f32,
}

impl RacerSim {
    /// Create a new racer simulation.
    #[allow(clippy::too_many_arguments)]
    fn new(
        engine: Engine,
        module: Module,
        wheels: Vec<WheelEntry>,
        terrain: &[(f32, f32)],
        obstacles: &[Obstacle],
        finish_x: f32,
        start_x: f32,
        start_y: f32,
        max_ticks: u32,
        seed: u32,
    ) -> Result<Self> {
        let mut store = Store::new(&engine, ());
        let linker = Linker::new(&engine);
        let instance = linker
            .instantiate(&mut store, &module)
            .context("Failed to instantiate WASM module")?;

        // Get exported memory
        let memory = instance
            .get_memory(&mut store, "memory")
            .context("memory export not found")?;

        // Get WASM functions
        let resim_init = instance
            .get_typed_func::<(), i32>(&mut store, "resim_init")
            .context("resim_init export not found")?;

        let resim_step = instance
            .get_typed_func::<(), i32>(&mut store, "resim_step")
            .context("resim_step export not found")?;

        // Initialize memory with simulation data
        wasm_abi::init_memory(
            &memory, &mut store, &wheels, terrain, obstacles, finish_x, start_x, start_y,
            max_ticks, seed,
        )?;

        // Initialize simulation
        let init_result = resim_init.call(&mut store, ())?;
        if init_result != 1 {
            anyhow::bail!("resim_init failed: returned {}", init_result);
        }

        Ok(Self {
            _store: store,
            memory,
            resim_step,
            current_tick: 0,
            finished: false,
            start_x,
            start_y,
        })
    }

    /// Step the simulation forward by one tick.
    ///
    /// Returns the current state after the step, or None if finished.
    pub fn step(&mut self) -> Option<RacerPhysicsState> {
        if self.finished {
            return None;
        }

        // Step the simulation
        let step_result = self.resim_step.call(&mut self._store, ()).unwrap_or(0);

        // Read state
        let state = wasm_abi::read_state(&self.memory, &mut self._store).unwrap_or_else(|e| {
            tracing::error!(error = %e, "Failed to read WASM state");
            RacerStateInternal {
                sim_tick: self.current_tick,
                finished: false,
                stuck: true,
                chassis_x: self.start_x,
                chassis_y: self.start_y,
            }
        });

        self.current_tick = state.sim_tick;

        // Check if finished
        if state.finished || state.stuck || step_result == 0 {
            self.finished = true;
        }

        Some(RacerPhysicsState {
            x: state.chassis_x,
            y: state.chassis_y,
            angle: 0.0, // WASM doesn't expose angle yet
            tick: state.sim_tick,
            finished: state.finished,
            stuck: state.stuck,
        })
    }

    /// Get the current tick count.
    pub fn current_tick(&self) -> u32 {
        self.current_tick
    }

    /// Check if the racer has finished.
    pub fn is_finished(&self) -> bool {
        self.finished
    }
}

/// Physics state snapshot for a racer.
#[derive(Debug, Clone)]
pub struct RacerPhysicsState {
    /// X position in meters
    pub x: f32,
    /// Y position in meters
    pub y: f32,
    /// Heading angle in radians (not yet exposed by WASM)
    pub angle: f32,
    /// Current simulation tick
    pub tick: u32,
    /// Whether the racer has finished
    pub finished: bool,
    /// Whether the racer is stuck (DNF)
    pub stuck: bool,
}

/// Internal state read from WASM
struct RacerStateInternal {
    sim_tick: u32,
    finished: bool,
    stuck: bool,
    chassis_x: f32,
    chassis_y: f32,
}

/// Obstacle descriptor
#[derive(Debug, Clone)]
pub struct Obstacle {
    pub obstacle_type: ObstacleType,
    pub pos_x: f32,
    pub pos_y: f32,
    pub size_x: f32,
    pub size_y: f32,
    pub radius: f32,
    pub angle: f32,
    pub friction: f32,
}

#[derive(Debug, Clone, Copy)]
pub enum ObstacleType {
    Box = 0,
    Circle = 1,
}

/// WASM ABI constants (minimal subset needed for init_memory)
mod wasm_abi {
    use super::*;
    use std::ptr;

    pub const ABI_MAGIC: u32 = 0x52534D49;
    pub const ABI_VERSION: u32 = 1;
    pub const MAX_WHEELS: u32 = 21;
    #[allow(dead_code)]
    pub const MAX_TERRAIN_POINTS: u32 = 100;
    #[allow(dead_code)]
    pub const MAX_OBSTACLES: u32 = 50;
    #[allow(dead_code)]
    pub const MAX_VERTICES_PER_WHEEL: u32 = 32;
    #[allow(dead_code)]
    pub const MAX_TOTAL_VERTICES: u32 = MAX_WHEELS * MAX_VERTICES_PER_WHEEL;

    pub const HEADER_OFFSET: u32 = 0;
    pub const HEADER_SIZE: u32 = 256;
    pub const WHEEL_ARRAY_OFFSET: u32 = HEADER_OFFSET + HEADER_SIZE;
    pub const WHEEL_DESC_SIZE: u32 = 16;
    #[allow(dead_code)]
    pub const WHEEL_ARRAY_SIZE: u32 = MAX_WHEELS * WHEEL_DESC_SIZE;
    pub const VERTEX_BUFFER_OFFSET: u32 = 8192;
    #[allow(dead_code)]
    pub const VERTEX_BUFFER_SIZE: u32 = MAX_TOTAL_VERTICES * 4;
    pub const TRACK_DATA_OFFSET: u32 = 24576;
    #[allow(dead_code)]
    pub const TRACK_DATA_SIZE: u32 = 16384;
    pub const STATE_OFFSET: u32 = 49152;
    pub const STATE_SIZE: u32 = 256;
    pub const RESULT_OFFSET: u32 = 65536;
    #[allow(dead_code)]
    pub const RESULT_SIZE: u32 = 256;
    #[allow(dead_code)]
    pub const TOTAL_MEMORY_SIZE: u32 = 131072;

    mod header {
        pub const MAGIC: u32 = 0;
        pub const VERSION: u32 = 4;
        pub const NUM_WHEELS: u32 = 8;
        pub const MAX_WHEELS: u32 = 12;
        pub const TERRAIN_COUNT: u32 = 16;
        pub const OBSTACLE_COUNT: u32 = 20;
        pub const FINISH_X: u32 = 24;
        pub const START_X: u32 = 28;
        pub const START_Y: u32 = 32;
        pub const CLAIMED_FINISH: u32 = 36;
        pub const MAX_TICKS: u32 = 40;
        pub const INITIAL_VCOUNT: u32 = 44;
        pub const SEED: u32 = 48;
    }

    mod wheel_desc {
        pub const SWAP_TICK: u32 = 0;
        pub const VERTEX_COUNT: u32 = 4;
        pub const VERTEX_OFFSET: u32 = 8;
        #[allow(dead_code)]
        pub const RESERVED: u32 = 12;
    }

    mod track_data {
        pub const TERRAIN_START: u32 = 0;
        pub const OBSTACLES_START: u32 = 8192;
    }

    mod obstacle {
        pub const TYPE: u32 = 0;
        pub const POS_X: u32 = 4;
        pub const POS_Y: u32 = 8;
        pub const SIZE_X: u32 = 12;
        pub const SIZE_Y: u32 = 16;
        pub const RADIUS: u32 = 12; // Same as SIZE_X
        pub const ANGLE: u32 = 20;
        pub const FRICTION: u32 = 24;
        pub const SIZE: u32 = 28;
    }

    mod state {
        pub const SIM_TICK: u32 = 0;
        pub const FINISHED: u32 = 4;
        pub const STUCK: u32 = 8;
        pub const CHASSIS_X: u32 = 16;
        pub const CHASSIS_Y: u32 = 20;
    }

    fn write_u32(
        memory: &Memory,
        store: &mut wasmtime::Store<()>,
        offset: u32,
        value: u32,
    ) -> anyhow::Result<()> {
        let data = memory.data_mut(store);
        let offset = offset as usize;
        if offset + 4 > data.len() {
            anyhow::bail!("Memory write out of bounds");
        }
        unsafe {
            ptr::write(data.as_mut_ptr().add(offset) as *mut u32, value.to_le());
        }
        Ok(())
    }

    fn write_f32(
        memory: &Memory,
        store: &mut wasmtime::Store<()>,
        offset: u32,
        value: f32,
    ) -> anyhow::Result<()> {
        let data = memory.data_mut(store);
        let offset = offset as usize;
        if offset + 4 > data.len() {
            anyhow::bail!("Memory write out of bounds");
        }
        unsafe {
            ptr::write(
                data.as_mut_ptr().add(offset) as *mut u32,
                value.to_bits().to_le(),
            );
        }
        Ok(())
    }

    fn write_vertex(
        memory: &Memory,
        store: &mut wasmtime::Store<()>,
        offset: u32,
        x: i16,
        y: i16,
    ) -> anyhow::Result<()> {
        let data = memory.data_mut(store);
        let offset = offset as usize;
        if offset + 4 > data.len() {
            anyhow::bail!("Memory write out of bounds");
        }
        unsafe {
            ptr::write(data.as_mut_ptr().add(offset) as *mut i16, x.to_le());
            ptr::write(data.as_mut_ptr().add(offset + 2) as *mut i16, y.to_le());
        }
        Ok(())
    }

    fn read_u32(
        memory: &Memory,
        store: &mut wasmtime::Store<()>,
        offset: u32,
    ) -> anyhow::Result<u32> {
        let data = memory.data(store);
        let offset = offset as usize;
        if offset + 4 > data.len() {
            anyhow::bail!("Memory read out of bounds");
        }
        unsafe {
            Ok(u32::from_le(ptr::read(
                data.as_ptr().add(offset) as *const u32
            )))
        }
    }

    fn read_f32(
        memory: &Memory,
        store: &mut wasmtime::Store<()>,
        offset: u32,
    ) -> anyhow::Result<f32> {
        let data = memory.data(store);
        let offset = offset as usize;
        if offset + 4 > data.len() {
            anyhow::bail!("Memory read out of bounds");
        }
        unsafe {
            let bits = u32::from_le(ptr::read(data.as_ptr().add(offset) as *const u32));
            Ok(f32::from_bits(bits))
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn init_memory(
        memory: &Memory,
        store: &mut wasmtime::Store<()>,
        wheels: &[WheelEntry],
        terrain: &[(f32, f32)],
        obstacles: &[Obstacle],
        finish_x: f32,
        start_x: f32,
        start_y: f32,
        max_ticks: u32,
        seed: u32,
    ) -> anyhow::Result<()> {
        let initial_vcount = wheels.first().map(|w| w.vertex_count as u32).unwrap_or(12);

        // Write header
        let o = HEADER_OFFSET;
        write_u32(memory, store, o + header::MAGIC, ABI_MAGIC)?;
        write_u32(memory, store, o + header::VERSION, ABI_VERSION)?;
        write_u32(memory, store, o + header::NUM_WHEELS, wheels.len() as u32)?;
        write_u32(memory, store, o + header::MAX_WHEELS, MAX_WHEELS)?;
        write_u32(
            memory,
            store,
            o + header::TERRAIN_COUNT,
            terrain.len() as u32,
        )?;
        write_u32(
            memory,
            store,
            o + header::OBSTACLE_COUNT,
            obstacles.len() as u32,
        )?;
        write_f32(memory, store, o + header::FINISH_X, finish_x)?;
        write_f32(memory, store, o + header::START_X, start_x)?;
        write_f32(memory, store, o + header::START_Y, start_y)?;
        write_u32(memory, store, o + header::CLAIMED_FINISH, max_ticks)?;
        write_u32(memory, store, o + header::MAX_TICKS, max_ticks)?;
        write_u32(memory, store, o + header::INITIAL_VCOUNT, initial_vcount)?;
        write_u32(memory, store, o + header::SEED, seed)?;

        // Write wheels
        let mut vertex_offset = 0u32;
        let o = WHEEL_ARRAY_OFFSET;

        for (i, wheel) in wheels.iter().enumerate() {
            let wheel_offset = o + (i as u32) * WHEEL_DESC_SIZE;

            write_u32(
                memory,
                store,
                wheel_offset + wheel_desc::SWAP_TICK,
                wheel.swap_tick,
            )?;
            write_u32(
                memory,
                store,
                wheel_offset + wheel_desc::VERTEX_COUNT,
                wheel.vertex_count as u32,
            )?;
            write_u32(
                memory,
                store,
                wheel_offset + wheel_desc::VERTEX_OFFSET,
                vertex_offset,
            )?;

            // Write vertices to vertex buffer
            let vertex_buffer_offset = VERTEX_BUFFER_OFFSET + vertex_offset * 4;
            for (j, &(x, y)) in wheel.polygon_vertices.iter().enumerate() {
                write_vertex(memory, store, vertex_buffer_offset + (j as u32) * 4, x, y)?;
            }

            vertex_offset += wheel.vertex_count as u32;
        }

        // Write terrain
        let o = TRACK_DATA_OFFSET + track_data::TERRAIN_START;
        for (i, &(x, y)) in terrain.iter().enumerate() {
            write_f32(memory, store, o + (i as u32) * 8, x)?;
            write_f32(memory, store, o + (i as u32) * 8 + 4, y)?;
        }

        // Write obstacles
        let o = TRACK_DATA_OFFSET + track_data::OBSTACLES_START;
        for (i, obs) in obstacles.iter().enumerate() {
            let offset = o + (i as u32) * obstacle::SIZE;

            write_u32(
                memory,
                store,
                offset + obstacle::TYPE,
                obs.obstacle_type as u32,
            )?;
            write_f32(memory, store, offset + obstacle::POS_X, obs.pos_x)?;
            write_f32(memory, store, offset + obstacle::POS_Y, obs.pos_y)?;

            match obs.obstacle_type {
                ObstacleType::Box => {
                    write_f32(memory, store, offset + obstacle::SIZE_X, obs.size_x)?;
                    write_f32(memory, store, offset + obstacle::SIZE_Y, obs.size_y)?;
                }
                ObstacleType::Circle => {
                    write_f32(memory, store, offset + obstacle::RADIUS, obs.radius)?;
                }
            }

            write_f32(memory, store, offset + obstacle::ANGLE, obs.angle)?;
            write_f32(memory, store, offset + obstacle::FRICTION, obs.friction)?;
        }

        // Initialize state to zero
        for i in 0..STATE_SIZE / 4 {
            write_u32(memory, store, STATE_OFFSET + i * 4, 0)?;
        }

        // Initialize result to zero
        write_u32(memory, store, RESULT_OFFSET, u32::MAX)?;
        write_u32(memory, store, RESULT_OFFSET + 4, 0)?;

        Ok(())
    }

    pub fn read_state(
        memory: &Memory,
        store: &mut wasmtime::Store<()>,
    ) -> anyhow::Result<RacerStateInternal> {
        let o = STATE_OFFSET;

        Ok(RacerStateInternal {
            sim_tick: read_u32(memory, store, o + state::SIM_TICK)?,
            finished: read_u32(memory, store, o + state::FINISHED)? != 0,
            stuck: read_u32(memory, store, o + state::STUCK)? != 0,
            chassis_x: read_f32(memory, store, o + state::CHASSIS_X)?,
            chassis_y: read_f32(memory, store, o + state::CHASSIS_Y)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_physics_engine() {
        match PhysicsEngine::load() {
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
                panic!("Failed to load physics engine: {}", e);
            }
        }
    }
}
