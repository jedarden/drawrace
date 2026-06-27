/// # WASM ABI for engine-core Re-simulation
///
/// This module documents and implements the ABI contract between the Rust host
/// (validator) and the WASM module (engine-core physics simulation). The ABI
/// consists of exported WASM functions and a shared linear memory layout.
///
/// ## Source of Truth
///
/// The TypeScript source at `packages/engine-core/src/wasm-resim.ts` is the
/// authoritative ABI definition. This Rust module must be kept in sync with it.
///
/// ## WASM Module Exports
///
/// The WASM module exports the following functions:
///
/// ### Core Simulation Functions
///
/// - `resim_init() -> i32`: Initialize simulation from memory.
///   - Returns `1` on success, `0` on failure (e.g., invalid header).
///   - Reads input from all memory regions (Header, Wheel Array, Vertex Buffer, Track Data).
///   - Initializes State region to zero.
///   - Initializes Result region (finish_ticks = 0xFFFFFFFF).
///
/// - `resim_step() -> i32`: Advance simulation by one tick.
///   - Returns `1` if simulation should continue, `0` if finished/stuck/timeout.
///   - Applies any wheel swaps scheduled for the current tick.
///   - Updates State region with current simulation state.
///   - Updates Result region when finished.
///
/// - `resim_swap_wheel(vertexCount: i32) -> i32`: Apply a wheel swap.
///   - Returns `1` on success, `0` if simulation already finished.
///   - Logs the swap to the swap log in Result region.
///   - Note: In the full physics implementation, swaps are applied automatically
///     during `resim_step()` based on the swap_tick in wheel descriptors.
///
/// ### Query Functions
///
/// - `resim_is_finished() -> i32`: Returns `1` if simulation finished, `0` otherwise.
/// - `resim_is_stuck() -> i32`: Returns `1` if simulation stuck (DNF), `0` otherwise.
/// - `resim_get_tick() -> i32`: Returns current simulation tick count.
/// - `resim_get_swaps_applied() -> i32`: Returns number of wheel swaps applied.
///
/// ### Module Metadata
///
/// - `physics_version() -> i32`: Returns physics version constant.
/// - `wasm_validate() -> i32`: Returns `1` if module is functioning.
///
/// ### Memory Export
///
/// - `memory`: Exported WebAssembly.Memory (2 pages, 128KB).
///   - Fixed size: initial=2, maximum=2.
///   - Host uses this to read/write shared state.
///
/// ## Memory Layout
///
/// All offsets are in bytes from the start of the WASM linear memory.
/// Total memory size: 128KB (2 pages of 64KB each).
///
/// ```text
/// +------------------+----------+----------------------------------------+
/// | Region           | Offset   | Description                            |
/// +------------------+----------+----------------------------------------+
/// | Header           | 0        | Constants, configuration               |
/// | Wheel Array      | 256      | Fixed-size wheel descriptors (max 21)   |
/// | Vertex Buffer    | 8192     | Shared vertex storage (i16 pairs)       |
/// | Track Data       | 24576    | Terrain points, obstacles               |
/// | State            | 49152    | Runtime simulation state                |
/// | Result           | 65536    | Output: finish ticks, swap log          |
/// +------------------+----------+----------------------------------------+
/// ```
///
/// ## Header Region (offset 0, size 256 bytes)
///
/// ```text
/// Offset  Name            Type    Description
/// ------ ---------------  ------  ---------------------------------------
/// 0      MAGIC            u32     Magic number 0x52534D49 ("RSIM")
/// 4      VERSION          u32     ABI version (must be 1)
/// 8      NUM_WHEELS       u32     Number of wheels in wheel array
/// 12     MAX_WHEELS       u32     Maximum wheel capacity (21)
/// 16     TERRAIN_COUNT    u32     Number of terrain points
/// 20     OBSTACLE_COUNT   u32     Number of obstacles
/// 24     FINISH_X         f32     X coordinate of finish line
/// 28     START_X          f32     X coordinate of start position
/// 32     START_Y          f32     Y coordinate of start position
/// 36     CLAIMED_FINISH   u32     Client's claimed finish tick count
/// 40     MAX_TICKS        u32     Maximum ticks before timeout
/// 44     INITIAL_VCOUNT   u32     Vertex count of initial wheel
/// 48     SEED             u32     PRNG seed for deterministic simulation
/// 52-255 RESERVED        [204]   Reserved for future use
/// ```
///
/// ## Wheel Array (offset 256, size up to 336 bytes)
///
/// Fixed-size array of wheel descriptors. Each descriptor is 16 bytes:
///
/// ```text
/// Offset  Name            Type    Description
/// ------ ---------------  ------  ---------------------------------------
/// 0      SWAP_TICK        u32     Tick at which this wheel shape applies
/// 4      VERTEX_COUNT     u32     Number of vertices in this wheel
/// 8      VERTEX_OFFSET    u32     Offset into vertex buffer for first vertex
/// 12-15  RESERVED         [4]     Reserved for future use
/// ```
///
/// The first wheel must have `SWAP_TICK = 0` (initial wheel).
/// Subsequent wheels must have strictly increasing `SWAP_TICK` values.
///
/// ## Vertex Buffer (offset 8192)
///
/// Shared storage for all wheel vertices. Each vertex is 4 bytes:
///
/// ```text
/// Offset  Name            Type    Description
/// ------ ---------------  ------  ---------------------------------------
/// 0      X                i16     Vertex X coordinate (hundredths of meter)
/// 2      Y                i16     Vertex Y coordinate (hundredths of meter)
/// ```
///
/// Vertices are stored contiguously. The `VERTEX_OFFSET` in each wheel
/// descriptor points to the first vertex for that wheel.
///
/// ## Track Data (offset 24576)
///
/// ### Terrain Points (offset 24576)
///
/// Array of terrain points. Each point is 8 bytes:
///
/// ```text
/// Offset  Name            Type    Description
/// ------ ---------------  ------  ---------------------------------------
/// 0      X                f32     Point X coordinate (meters)
/// 4      Y                f32     Point Y coordinate (meters)
/// ```
///
/// ### Obstacles (offset 32768 = 24576 + 8192)
///
/// Array of obstacle descriptors. Each obstacle is 28 bytes:
///
/// ```text
/// Offset  Name            Type    Description
/// ------ ---------------  ------  ---------------------------------------
/// 0      TYPE             u32     0 = box, 1 = circle
/// 4      POS_X            f32     Position X (meters)
/// 8      POS_Y            f32     Position Y (meters)
/// 12     SIZE_X           f32     Width (box only, meters)
/// 16     SIZE_Y           f32     Height (box only, meters)
/// 20     RADIUS           f32     Radius (circle only, meters)
/// 24     ANGLE            f32     Rotation angle (radians)
/// ```
///
/// ## State Region (offset 49152, size 256 bytes)
///
/// Runtime simulation state, updated after each `resim_step()` call:
///
/// ```text
/// Offset  Name            Type    Description
/// ------ ---------------  ------  ---------------------------------------
/// 0      SIM_TICK         u32     Current simulation tick
/// 4      FINISHED         u32     1 if simulation finished, 0 otherwise
/// 8      STUCK            u32     1 if stuck (DNF), 0 otherwise
/// 12     SWAPS_APPLIED    u32     Number of wheel swaps applied
/// 16     CHASSIS_X        f32     Chassis X position (meters)
/// 20     CHASSIS_Y        f32     Chassis Y position (meters)
/// 24     FRONT_ANG_VEL    f32     Front wheel angular velocity
/// 28     REAR_ANG_VEL     f32     Rear wheel angular velocity
/// 32-255 RESERVED        [224]   Reserved for future use
/// ```
///
/// ## Result Region (offset 65536, size 256 bytes)
///
/// Simulation output, written when simulation finishes:
///
/// ```text
/// Offset  Name            Type    Description
/// ------ ---------------  ------  ---------------------------------------
/// 0      FINISH_TICKS     u32     Tick count when finished, or 0xFFFFFFFF
/// 4      STUCK            u32     1 if DNF (stuck), 0 otherwise
/// 8      SWAP_LOG_OFFSET  u32     Offset to swap log data (usually 65552)
/// 12     SWAP_LOG_COUNT   u32     Number of swap log entries
/// 16-255 SWAP_LOG_DATA    [240]   Swap log entries (8 bytes each)
/// ```
///
/// Swap log entry format (8 bytes each):
///
/// ```text
/// Offset  Name            Type    Description
/// ------ ---------------  ------  ---------------------------------------
/// 0      SWAP_TICK        u32     Tick when swap was applied
/// 4      VERTEX_COUNT     u32     Vertex count of swapped wheel
/// ```
///
/// ## Usage Pattern
///
/// 1. Host writes all input regions (Header, Wheel Array, Vertex Buffer, Track Data).
/// 2. Host calls `resim_init()`. On failure, abort.
/// 3. Host calls `resim_step()` in a loop until it returns 0.
/// 4. Host reads Result region for outcome and swap log.
///
/// ABI magic number for validation: "RSIM" (Re-SIM)
pub const ABI_MAGIC: u32 = 0x52534D49;

/// ABI version number
pub const ABI_VERSION: u32 = 1;

/// Maximum number of wheels supported
pub const MAX_WHEELS: u32 = 21;

/// Maximum number of terrain points
pub const MAX_TERRAIN_POINTS: u32 = 100;

/// Maximum number of obstacles
pub const MAX_OBSTACLES: u32 = 50;

/// Maximum vertices per wheel
pub const MAX_VERTICES_PER_WHEEL: u32 = 32;

/// Maximum total vertices across all wheels
#[allow(dead_code)]
pub const MAX_TOTAL_VERTICES: u32 = MAX_WHEELS * MAX_VERTICES_PER_WHEEL;

/// Header region offset (start of memory)
pub const HEADER_OFFSET: u32 = 0;

/// Header region size (256 bytes, aligned)
pub const HEADER_SIZE: u32 = 256;

/// Wheel array offset (immediately after header)
pub const WHEEL_ARRAY_OFFSET: u32 = HEADER_OFFSET + HEADER_SIZE;

/// Wheel descriptor size (swap_tick + vertex_count + vertex_offset + reserved)
pub const WHEEL_DESC_SIZE: u32 = 16;

/// Wheel array size (MAX_WHEELS * WHEEL_DESC_SIZE, aligned)
#[allow(dead_code)]
pub const WHEEL_ARRAY_SIZE: u32 = MAX_WHEELS * WHEEL_DESC_SIZE; // 336 bytes, rounded to 512

/// Vertex buffer offset (after wheel array, aligned to 8192)
pub const VERTEX_BUFFER_OFFSET: u32 = 8192;

/// Vertex buffer size (each vertex is 2 i16 values = 4 bytes)
#[allow(dead_code)]
pub const VERTEX_BUFFER_SIZE: u32 = MAX_TOTAL_VERTICES * 4; // 2688 bytes

/// Track data offset (after vertex buffer, aligned to 24576)
pub const TRACK_DATA_OFFSET: u32 = 24576;

/// Track data size (terrain + obstacles + reserved)
#[allow(dead_code)]
pub const TRACK_DATA_SIZE: u32 = 16384;

/// State offset (after track data, aligned to 49152)
pub const STATE_OFFSET: u32 = 49152;

/// State size
pub const STATE_SIZE: u32 = 256;

/// Result offset (after state, aligned to 65536)
pub const RESULT_OFFSET: u32 = 65536;

/// Result size
#[allow(dead_code)]
pub const RESULT_SIZE: u32 = 256;

/// Total required memory size (result + size, aligned to 64KB = 1 page)
pub const TOTAL_MEMORY_SIZE: u32 = 131072; // 2 pages (128KB)

/// State offsets within STATE region
pub mod state {
    pub const SIM_TICK: u32 = 0;
    pub const FINISHED: u32 = 4;
    pub const STUCK: u32 = 8;
    pub const SWAPS_APPLIED: u32 = 12;
    pub const CHASSIS_X: u32 = 16;
    pub const CHASSIS_Y: u32 = 20;
    pub const FRONT_ANG_VEL: u32 = 24;
    pub const REAR_ANG_VEL: u32 = 28;
}

/// Result offsets within RESULT region
pub mod result {
    pub const FINISH_TICKS: u32 = 0;
    pub const STUCK: u32 = 4;
    pub const SWAP_LOG_OFFSET: u32 = 8;
    pub const SWAP_LOG_COUNT: u32 = 12;
    #[allow(dead_code)]
    pub const RESERVED: u32 = 16;
}

/// Header field offsets within HEADER region
pub mod header {
    #[allow(dead_code)]
    pub const MAGIC: u32 = 0;
    #[allow(dead_code)]
    pub const VERSION: u32 = 4;
    #[allow(dead_code)]
    pub const NUM_WHEELS: u32 = 8;
    #[allow(dead_code)]
    pub const MAX_WHEELS: u32 = 12;
    #[allow(dead_code)]
    pub const TERRAIN_COUNT: u32 = 16;
    #[allow(dead_code)]
    pub const OBSTACLE_COUNT: u32 = 20;
    #[allow(dead_code)]
    pub const FINISH_X: u32 = 24;
    #[allow(dead_code)]
    pub const START_X: u32 = 28;
    #[allow(dead_code)]
    pub const START_Y: u32 = 32;
    #[allow(dead_code)]
    pub const CLAIMED_FINISH: u32 = 36;
    #[allow(dead_code)]
    pub const MAX_TICKS: u32 = 40;
    #[allow(dead_code)]
    pub const INITIAL_VCOUNT: u32 = 44;
    #[allow(dead_code)]
    pub const SEED: u32 = 48;
}

/// Wheel descriptor offsets within WHEEL_DESC
pub mod wheel_desc {
    pub const SWAP_TICK: u32 = 0;
    pub const VERTEX_COUNT: u32 = 4;
    pub const VERTEX_OFFSET: u32 = 8;
    pub const RESERVED: u32 = 12;
}

/// Track data offsets within TRACK region
pub mod track_data {
    /// Start of terrain points array (pairs of f32)
    pub const TERRAIN_START: u32 = 0;
    /// Start of obstacles array
    pub const OBSTACLES_START: u32 = 8192;
}

/// Obstacle descriptor offsets
pub mod obstacle {
    pub const TYPE: u32 = 0; // 0 = box, 1 = circle
    pub const POS_X: u32 = 4; // f32
    pub const POS_Y: u32 = 8; // f32
    pub const SIZE_X: u32 = 12; // f32 (box only)
    pub const SIZE_Y: u32 = 16; // f32 (box only)
    pub const RADIUS: u32 = 12; // f32 (circle only)
    pub const ANGLE: u32 = 20; // f32
    pub const FRICTION: u32 = 24; // f32
    pub const SIZE: u32 = 28; // total size
}

/// Swap log entry format (in RESULT region)
pub const SWAP_LOG_ENTRY_SIZE: u32 = 8; // swap_tick (u32) + vertex_count (u32)

pub use drawrace_api::blob::WheelEntry;
use std::ptr;
use wasmtime::Memory;

/// Write a u32 value to WASM memory at the given offset.
pub fn write_u32(
    memory: &Memory,
    mut store: &mut wasmtime::Store<()>,
    offset: u32,
    value: u32,
) -> anyhow::Result<()> {
    let data = memory.data_mut(&mut store);
    let offset = offset as usize;
    if offset + 4 > data.len() {
        anyhow::bail!(
            "Memory write out of bounds: offset={}, size=4, len={}",
            offset,
            data.len()
        );
    }
    unsafe {
        ptr::write(data.as_mut_ptr().add(offset) as *mut u32, value.to_le());
    }
    Ok(())
}

/// Write a f32 value to WASM memory at the given offset.
pub fn write_f32(
    memory: &Memory,
    mut store: &mut wasmtime::Store<()>,
    offset: u32,
    value: f32,
) -> anyhow::Result<()> {
    let data = memory.data_mut(&mut store);
    let offset = offset as usize;
    if offset + 4 > data.len() {
        anyhow::bail!(
            "Memory write out of bounds: offset={}, size=4, len={}",
            offset,
            data.len()
        );
    }
    unsafe {
        ptr::write(
            data.as_mut_ptr().add(offset) as *mut u32,
            value.to_bits().to_le(),
        );
    }
    Ok(())
}

/// Write a vertex pair (i16, i16) to WASM memory at the given offset.
pub fn write_vertex(
    memory: &Memory,
    mut store: &mut wasmtime::Store<()>,
    offset: u32,
    x: i16,
    y: i16,
) -> anyhow::Result<()> {
    let data = memory.data_mut(&mut store);
    let offset = offset as usize;
    if offset + 4 > data.len() {
        anyhow::bail!(
            "Memory write out of bounds: offset={}, size=4, len={}",
            offset,
            data.len()
        );
    }
    unsafe {
        ptr::write(data.as_mut_ptr().add(offset) as *mut i16, x.to_le());
        ptr::write(data.as_mut_ptr().add(offset + 2) as *mut i16, y.to_le());
    }
    Ok(())
}

/// Read a u32 value from WASM memory at the given offset.
pub fn read_u32(
    memory: &Memory,
    mut store: &mut wasmtime::Store<()>,
    offset: u32,
) -> anyhow::Result<u32> {
    let data = memory.data(&mut store);
    let offset = offset as usize;
    if offset + 4 > data.len() {
        anyhow::bail!(
            "Memory read out of bounds: offset={}, size=4, len={}",
            offset,
            data.len()
        );
    }
    unsafe {
        Ok(u32::from_le(ptr::read(
            data.as_ptr().add(offset) as *const u32
        )))
    }
}

/// Read a f32 value from WASM memory at the given offset.
pub fn read_f32(
    memory: &Memory,
    mut store: &mut wasmtime::Store<()>,
    offset: u32,
) -> anyhow::Result<f32> {
    let data = memory.data(&mut store);
    let offset = offset as usize;
    if offset + 4 > data.len() {
        anyhow::bail!(
            "Memory read out of bounds: offset={}, size=4, len={}",
            offset,
            data.len()
        );
    }
    unsafe {
        let bits = u32::from_le(ptr::read(data.as_ptr().add(offset) as *const u32));
        Ok(f32::from_bits(bits))
    }
}

/// Read a u32 value from WASM memory at the given offset (offset + 4 bytes).
#[allow(dead_code)]
pub fn read_u32_at(
    memory: &Memory,
    store: &mut wasmtime::Store<()>,
    offset: u32,
    index: u32,
) -> anyhow::Result<u32> {
    read_u32(memory, store, offset + index * 4)
}

/// Read a i32 value from WASM memory at the given offset.
#[allow(dead_code)]
pub fn read_i32(
    memory: &Memory,
    mut store: &mut wasmtime::Store<()>,
    offset: u32,
) -> anyhow::Result<i32> {
    let data = memory.data(&mut store);
    let offset = offset as usize;
    if offset + 4 > data.len() {
        anyhow::bail!(
            "Memory read out of bounds: offset={}, size=4, len={}",
            offset,
            data.len()
        );
    }
    unsafe {
        Ok(i32::from_le(ptr::read(
            data.as_ptr().add(offset) as *const i32
        )))
    }
}

/// Read a i16 value from WASM memory at the given offset.
#[allow(dead_code)]
pub fn read_i16(
    memory: &Memory,
    mut store: &mut wasmtime::Store<()>,
    offset: u32,
) -> anyhow::Result<i16> {
    let data = memory.data(&mut store);
    let offset = offset as usize;
    if offset + 2 > data.len() {
        anyhow::bail!(
            "Memory read out of bounds: offset={}, size=2, len={}",
            offset,
            data.len()
        );
    }
    unsafe {
        Ok(i16::from_le(ptr::read(
            data.as_ptr().add(offset) as *const i16
        )))
    }
}

/// Write the header region to WASM memory.
#[allow(clippy::too_many_arguments)]
pub fn write_header(
    memory: &Memory,
    store: &mut wasmtime::Store<()>,
    num_wheels: u32,
    terrain_count: u32,
    obstacle_count: u32,
    finish_x: f32,
    start_x: f32,
    start_y: f32,
    claimed_finish: u32,
    initial_vcount: u32,
    seed: u32,
) -> anyhow::Result<()> {
    let o = HEADER_OFFSET;
    write_u32(memory, store, o, ABI_MAGIC)?;
    write_u32(memory, store, o + 4, ABI_VERSION)?;
    write_u32(memory, store, o + 8, num_wheels)?;
    write_u32(memory, store, o + 12, MAX_WHEELS)?;
    write_u32(memory, store, o + 16, terrain_count)?;
    write_u32(memory, store, o + 20, obstacle_count)?;
    write_f32(memory, store, o + 24, finish_x)?;
    write_f32(memory, store, o + 28, start_x)?;
    write_f32(memory, store, o + 32, start_y)?;
    write_u32(memory, store, o + 36, claimed_finish)?;
    write_u32(
        memory,
        store,
        o + 40,
        claimed_finish.saturating_mul(2).max(90 * 60),
    )?;
    write_u32(memory, store, o + 44, initial_vcount)?;
    write_u32(memory, store, o + 48, seed)?;
    Ok(())
}

/// Write wheel descriptors to WASM memory.
/// Returns the total number of vertices written.
pub fn write_wheels(
    memory: &Memory,
    store: &mut wasmtime::Store<()>,
    wheels: &[WheelEntry],
) -> anyhow::Result<u32> {
    if wheels.len() > MAX_WHEELS as usize {
        anyhow::bail!("Too many wheels: {} > {}", wheels.len(), MAX_WHEELS);
    }

    let mut vertex_offset = 0u32;
    let o = WHEEL_ARRAY_OFFSET;

    for (i, wheel) in wheels.iter().enumerate() {
        let wheel_offset = o + (i as u32) * WHEEL_DESC_SIZE;

        if wheel.vertex_count > MAX_VERTICES_PER_WHEEL as u8 {
            anyhow::bail!("Wheel {} has too many vertices: {}", i, wheel.vertex_count);
        }

        // Write wheel descriptor
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
        let vertex_buffer_offset = VERTEX_BUFFER_OFFSET + vertex_offset * 4; // 4 bytes per vertex (2 i16)
        for (j, &(x, y)) in wheel.polygon_vertices.iter().enumerate() {
            write_vertex(memory, store, vertex_buffer_offset + (j as u32) * 4, x, y)?;
        }

        vertex_offset += wheel.vertex_count as u32;
    }

    Ok(vertex_offset)
}

/// Write terrain points to WASM memory.
/// Each point is a pair of f32 values (x, y).
pub fn write_terrain(
    memory: &Memory,
    store: &mut wasmtime::Store<()>,
    terrain: &[(f32, f32)],
) -> anyhow::Result<()> {
    if terrain.len() > MAX_TERRAIN_POINTS as usize {
        anyhow::bail!(
            "Too many terrain points: {} > {}",
            terrain.len(),
            MAX_TERRAIN_POINTS
        );
    }

    let o = TRACK_DATA_OFFSET + track_data::TERRAIN_START;

    for (i, &(x, y)) in terrain.iter().enumerate() {
        write_f32(memory, store, o + (i as u32) * 8, x)?;
        write_f32(memory, store, o + (i as u32) * 8 + 4, y)?;
    }

    Ok(())
}

/// Obstacle type enumeration
#[derive(Debug, Clone, Copy)]
pub enum ObstacleType {
    Box = 0,
    Circle = 1,
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

/// Write obstacles to WASM memory.
pub fn write_obstacles(
    memory: &Memory,
    store: &mut wasmtime::Store<()>,
    obstacles: &[Obstacle],
) -> anyhow::Result<()> {
    if obstacles.len() > MAX_OBSTACLES as usize {
        anyhow::bail!(
            "Too many obstacles: {} > {}",
            obstacles.len(),
            MAX_OBSTACLES
        );
    }

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

        // Write type-specific fields (SIZE_X and RADIUS share offset 12)
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

    Ok(())
}

/// Read the result region from WASM memory.
pub fn read_result(memory: &Memory, store: &mut wasmtime::Store<()>) -> anyhow::Result<SimResult> {
    let o = RESULT_OFFSET;

    let finish_ticks = read_u32(memory, store, o + result::FINISH_TICKS)?;
    let stuck = read_u32(memory, store, o + result::STUCK)? != 0;
    let swap_log_offset = read_u32(memory, store, o + result::SWAP_LOG_OFFSET)?;
    let swap_log_count = read_u32(memory, store, o + result::SWAP_LOG_COUNT)?;

    let mut swap_log = Vec::new();
    if swap_log_count > 0 {
        for i in 0..swap_log_count {
            let entry_offset = swap_log_offset + i * SWAP_LOG_ENTRY_SIZE;
            let swap_tick = read_u32(memory, store, entry_offset)?;
            let vertex_count = read_u32(memory, store, entry_offset + 4)?;
            swap_log.push((swap_tick, vertex_count as u8));
        }
    }

    Ok(SimResult {
        finish_ticks: if finish_ticks == u32::MAX {
            None
        } else {
            Some(finish_ticks)
        },
        stuck,
        swap_log,
    })
}

/// Simulation result from WASM
#[derive(Debug, Clone)]
pub struct SimResult {
    pub finish_ticks: Option<u32>,
    #[allow(dead_code)]
    pub stuck: bool,
    #[allow(dead_code)]
    pub swap_log: Vec<(u32, u8)>,
}

/// Initialize all memory regions for a re-simulation.
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
    claimed_finish: u32,
    seed: u32,
) -> anyhow::Result<()> {
    let initial_vcount = wheels.first().map(|w| w.vertex_count as u32).unwrap_or(12);

    write_header(
        memory,
        store,
        wheels.len() as u32,
        terrain.len() as u32,
        obstacles.len() as u32,
        finish_x,
        start_x,
        start_y,
        claimed_finish,
        initial_vcount,
        seed,
    )?;

    write_wheels(memory, store, wheels)?;
    write_terrain(memory, store, terrain)?;
    write_obstacles(memory, store, obstacles)?;

    // Initialize state to zero
    for i in 0..STATE_SIZE / 4 {
        write_u32(memory, store, STATE_OFFSET + i * 4, 0)?;
    }

    // Initialize result to zero (finish_ticks = u32::MAX means not finished)
    write_u32(
        memory,
        store,
        RESULT_OFFSET + result::FINISH_TICKS,
        u32::MAX,
    )?;
    write_u32(memory, store, RESULT_OFFSET + result::STUCK, 0)?;
    write_u32(memory, store, RESULT_OFFSET + result::SWAP_LOG_COUNT, 0)?;

    Ok(())
}

/// Read the seed from the header region.
pub fn read_seed(memory: &Memory, store: &mut wasmtime::Store<()>) -> anyhow::Result<u32> {
    read_u32(memory, store, HEADER_OFFSET + header::SEED)
}

/// Read the current simulation state from WASM memory.
pub fn read_state(memory: &Memory, store: &mut wasmtime::Store<()>) -> anyhow::Result<SimState> {
    let o = STATE_OFFSET;

    Ok(SimState {
        sim_tick: read_u32(memory, store, o + state::SIM_TICK)?,
        finished: read_u32(memory, store, o + state::FINISHED)? != 0,
        stuck: read_u32(memory, store, o + state::STUCK)? != 0,
        swaps_applied: read_u32(memory, store, o + state::SWAPS_APPLIED)?,
        chassis_x: read_f32(memory, store, o + state::CHASSIS_X)?,
        chassis_y: read_f32(memory, store, o + state::CHASSIS_Y)?,
        front_ang_vel: read_f32(memory, store, o + state::FRONT_ANG_VEL)?,
        rear_ang_vel: read_f32(memory, store, o + state::REAR_ANG_VEL)?,
    })
}

/// Current simulation state snapshot
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct SimState {
    pub sim_tick: u32,
    pub finished: bool,
    pub stuck: bool,
    pub swaps_applied: u32,
    pub chassis_x: f32,
    pub chassis_y: f32,
    pub front_ang_vel: f32,
    pub rear_ang_vel: f32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_abi_constants() {
        assert_eq!(ABI_MAGIC, 0x52534D49);
        assert_eq!(ABI_VERSION, 1);
        assert_eq!(MAX_WHEELS, 21);
        assert_eq!(MAX_TERRAIN_POINTS, 100);
        assert_eq!(MAX_OBSTACLES, 50);
        assert_eq!(MAX_VERTICES_PER_WHEEL, 32);
    }

    #[test]
    fn test_memory_layout() {
        // Check that regions don't overlap
        const { assert!(HEADER_OFFSET + HEADER_SIZE <= WHEEL_ARRAY_OFFSET) };
        const { assert!(WHEEL_ARRAY_OFFSET + WHEEL_ARRAY_SIZE <= VERTEX_BUFFER_OFFSET) };
        const { assert!(VERTEX_BUFFER_OFFSET + VERTEX_BUFFER_SIZE <= TRACK_DATA_OFFSET) };
        const { assert!(TRACK_DATA_OFFSET + TRACK_DATA_SIZE <= STATE_OFFSET) };
        const { assert!(STATE_OFFSET + STATE_SIZE <= RESULT_OFFSET) };
        const { assert!(RESULT_OFFSET + RESULT_SIZE <= TOTAL_MEMORY_SIZE) };
    }

    #[test]
    fn test_wheel_descriptor_size() {
        assert_eq!(WHEEL_DESC_SIZE, 16);
    }

    /// Test byte layout validation against a known fixture.
    ///
    /// This test validates that inputs are marshaled to WASM memory
    /// with the exact byte layout specified by the ABI.
    #[test]
    fn test_byte_layout_known_fixture() {
        use drawrace_api::blob::WheelEntry;
        use wasmtime::{Engine, MemoryType, Store};

        // Create a minimal WASM module that exports memory
        let config = wasmtime::Config::new();
        let engine = Engine::new(&config).expect("Failed to create engine");
        let mut store = Store::new(&engine, ());

        // Create memory with 2 pages (128KB)
        let memory_type = MemoryType::new(2, Some(2));
        let memory = Memory::new(&mut store, memory_type).expect("Failed to create memory");

        // === Known Fixture ===
        // Define test inputs with specific, verifiable values

        let _num_wheels: u32 = 2;
        let _terrain_count: u32 = 3;
        let _obstacle_count: u32 = 1;
        let finish_x: f32 = 1000.0;
        let start_x: f32 = 50.0;
        let start_y: f32 = 400.0;
        let claimed_finish: u32 = 1800;
        let _initial_vcount: u32 = 4;
        let seed: u32 = 42;

        let wheels = vec![
            WheelEntry {
                swap_tick: 0,
                vertex_count: 4,
                polygon_vertices: vec![
                    (-50, -50), // Vertex 0
                    (50, -50),  // Vertex 1
                    (50, 50),   // Vertex 2
                    (-50, 50),  // Vertex 3
                ],
            },
            WheelEntry {
                swap_tick: 100,
                vertex_count: 3,
                polygon_vertices: vec![
                    (0, -40),  // Vertex 4
                    (35, 20),  // Vertex 5
                    (-35, 20), // Vertex 6
                ],
            },
        ];

        let terrain = vec![(0.0, 500.0), (500.0, 450.0), (1000.0, 500.0)];

        let obstacles = vec![Obstacle {
            obstacle_type: ObstacleType::Box,
            pos_x: 200.0,
            pos_y: 470.0,
            size_x: 30.0,
            size_y: 20.0,
            radius: 0.0,
            angle: 0.0,
            friction: 0.8,
        }];

        // === Marshal inputs to memory ===
        let result = init_memory(
            &memory,
            &mut store,
            &wheels,
            &terrain,
            &obstacles,
            finish_x,
            start_x,
            start_y,
            claimed_finish,
            seed,
        );
        assert!(result.is_ok(), "init_memory failed: {:?}", result.err());

        // === Validate Header Region (offset 0) ===
        let data = memory.data(&store);

        // Magic: "RSIM" = 0x52534D49 (little-endian: 49 4D 53 52)
        assert_eq!(
            read_u32_slice(data, (HEADER_OFFSET + header::MAGIC) as usize),
            ABI_MAGIC
        );
        assert_eq!(
            read_u32_slice(data, (HEADER_OFFSET + header::VERSION) as usize),
            1
        );
        assert_eq!(
            read_u32_slice(data, (HEADER_OFFSET + header::NUM_WHEELS) as usize),
            2
        );
        assert_eq!(
            read_u32_slice(data, (HEADER_OFFSET + header::MAX_WHEELS) as usize),
            21
        );
        assert_eq!(
            read_u32_slice(data, (HEADER_OFFSET + header::TERRAIN_COUNT) as usize),
            3
        );
        assert_eq!(
            read_u32_slice(data, (HEADER_OFFSET + header::OBSTACLE_COUNT) as usize),
            1
        );
        assert_eq!(
            read_f32_slice(data, (HEADER_OFFSET + header::FINISH_X) as usize),
            1000.0
        );
        assert_eq!(
            read_f32_slice(data, (HEADER_OFFSET + header::START_X) as usize),
            50.0
        );
        assert_eq!(
            read_f32_slice(data, (HEADER_OFFSET + header::START_Y) as usize),
            400.0
        );
        assert_eq!(
            read_u32_slice(data, (HEADER_OFFSET + header::CLAIMED_FINISH) as usize),
            1800
        );
        // MAX_TICKS = claimed_finish * 2, but with minimum of 90*60 = 5400
        assert_eq!(
            read_u32_slice(data, (HEADER_OFFSET + header::MAX_TICKS) as usize),
            5400
        );
        assert_eq!(
            read_u32_slice(data, (HEADER_OFFSET + header::INITIAL_VCOUNT) as usize),
            4
        );
        assert_eq!(
            read_u32_slice(data, (HEADER_OFFSET + header::SEED) as usize),
            42
        );

        // === Validate Wheel Array (offset 256) ===
        // Wheel 0 (offset 256)
        let wheel0_offset = WHEEL_ARRAY_OFFSET as usize;
        assert_eq!(
            read_u32_slice(data, wheel0_offset + wheel_desc::SWAP_TICK as usize),
            0
        );
        assert_eq!(
            read_u32_slice(data, wheel0_offset + wheel_desc::VERTEX_COUNT as usize),
            4
        );
        assert_eq!(
            read_u32_slice(data, wheel0_offset + wheel_desc::VERTEX_OFFSET as usize),
            0
        );

        // Wheel 1 (offset 256 + 16 = 272)
        let wheel1_offset = WHEEL_ARRAY_OFFSET as usize + WHEEL_DESC_SIZE as usize;
        assert_eq!(
            read_u32_slice(data, wheel1_offset + wheel_desc::SWAP_TICK as usize),
            100
        );
        assert_eq!(
            read_u32_slice(data, wheel1_offset + wheel_desc::VERTEX_COUNT as usize),
            3
        );
        assert_eq!(
            read_u32_slice(data, wheel1_offset + wheel_desc::VERTEX_OFFSET as usize),
            4
        );

        // === Validate Vertex Buffer (offset 8192) ===
        // Vertices are stored as i16 pairs (x, y) in little-endian
        // Wheel 0 vertices (4 vertices, starting at offset 8192)
        let vbuf_offset = VERTEX_BUFFER_OFFSET as usize;

        // Vertex 0: (-50, -50)
        assert_eq!(read_i16_slice(data, vbuf_offset), -50);
        assert_eq!(read_i16_slice(data, vbuf_offset + 2), -50);

        // Vertex 1: (50, -50)
        assert_eq!(read_i16_slice(data, vbuf_offset + 4), 50);
        assert_eq!(read_i16_slice(data, vbuf_offset + 6), -50);

        // Vertex 2: (50, 50)
        assert_eq!(read_i16_slice(data, vbuf_offset + 8), 50);
        assert_eq!(read_i16_slice(data, vbuf_offset + 10), 50);

        // Vertex 3: (-50, 50)
        assert_eq!(read_i16_slice(data, vbuf_offset + 12), -50);
        assert_eq!(read_i16_slice(data, vbuf_offset + 14), 50);

        // Wheel 1 vertices (3 vertices, starting at offset 8192 + 4*4 = 8208)
        let wheel1_voffset = vbuf_offset + 4 * 4; // After wheel 0's 4 vertices

        // Vertex 4: (0, -40)
        assert_eq!(read_i16_slice(data, wheel1_voffset), 0);
        assert_eq!(read_i16_slice(data, wheel1_voffset + 2), -40);

        // Vertex 5: (35, 20)
        assert_eq!(read_i16_slice(data, wheel1_voffset + 4), 35);
        assert_eq!(read_i16_slice(data, wheel1_voffset + 6), 20);

        // Vertex 6: (-35, 20)
        assert_eq!(read_i16_slice(data, wheel1_voffset + 8), -35);
        assert_eq!(read_i16_slice(data, wheel1_voffset + 10), 20);

        // === Validate Terrain (offset 24576) ===
        let terrain_offset = TRACK_DATA_OFFSET as usize + track_data::TERRAIN_START as usize;

        // Terrain point 0: (0.0, 500.0)
        assert_eq!(read_f32_slice(data, terrain_offset), 0.0);
        assert_eq!(read_f32_slice(data, terrain_offset + 4), 500.0);

        // Terrain point 1: (500.0, 450.0)
        assert_eq!(read_f32_slice(data, terrain_offset + 8), 500.0);
        assert_eq!(read_f32_slice(data, terrain_offset + 12), 450.0);

        // Terrain point 2: (1000.0, 500.0)
        assert_eq!(read_f32_slice(data, terrain_offset + 16), 1000.0);
        assert_eq!(read_f32_slice(data, terrain_offset + 20), 500.0);

        // === Validate Obstacles (offset 24576 + 8192 = 32768) ===
        let obs_offset = TRACK_DATA_OFFSET as usize + track_data::OBSTACLES_START as usize;

        // Obstacle 0 (Box) - RADIUS is at same offset as SIZE_X, but we don't write it for Box
        assert_eq!(
            read_u32_slice(data, obs_offset + obstacle::TYPE as usize),
            0
        ); // Box
        assert_eq!(
            read_f32_slice(data, obs_offset + obstacle::POS_X as usize),
            200.0
        );
        assert_eq!(
            read_f32_slice(data, obs_offset + obstacle::POS_Y as usize),
            470.0
        );
        assert_eq!(
            read_f32_slice(data, obs_offset + obstacle::SIZE_X as usize),
            30.0
        );
        assert_eq!(
            read_f32_slice(data, obs_offset + obstacle::SIZE_Y as usize),
            20.0
        );
        // For Box obstacles, RADIUS (at same offset as SIZE_X) is not written
        assert_eq!(
            read_f32_slice(data, obs_offset + obstacle::ANGLE as usize),
            0.0
        );
        assert_eq!(
            read_f32_slice(data, obs_offset + obstacle::FRICTION as usize),
            0.8
        );

        // === Validate State Region (initialized to zero) ===
        let state_offset = STATE_OFFSET as usize;
        for i in 0..STATE_SIZE {
            assert_eq!(
                data[state_offset + i as usize],
                0,
                "State region should be initialized to zero at offset {}",
                i
            );
        }

        // === Validate Result Region (initialized) ===
        let result_offset = RESULT_OFFSET as usize;
        assert_eq!(
            read_u32_slice(data, result_offset + result::FINISH_TICKS as usize),
            u32::MAX
        );
        assert_eq!(
            read_u32_slice(data, result_offset + result::STUCK as usize),
            0
        );
        assert_eq!(
            read_u32_slice(data, result_offset + result::SWAP_LOG_COUNT as usize),
            0
        );
    }

    /// Helper to read u32 directly from a byte slice
    fn read_u32_slice(data: &[u8], offset: usize) -> u32 {
        u32::from_le_bytes([
            data[offset],
            data[offset + 1],
            data[offset + 2],
            data[offset + 3],
        ])
    }

    /// Helper to read i16 directly from a byte slice
    fn read_i16_slice(data: &[u8], offset: usize) -> i16 {
        i16::from_le_bytes([data[offset], data[offset + 1]])
    }

    /// Helper to read f32 directly from a byte slice
    fn read_f32_slice(data: &[u8], offset: usize) -> f32 {
        f32::from_bits(u32::from_le_bytes([
            data[offset],
            data[offset + 1],
            data[offset + 2],
            data[offset + 3],
        ]))
    }
}
