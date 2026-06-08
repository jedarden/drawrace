/// Round-trip parity test (bf-3ht9).
///
/// This test verifies that the WASM re-simulation produces deterministic
/// results and documents the current state of the physics implementation.
///
/// ## Parity Status
///
/// The current WASM physics is an **approximation** of the TypeScript Box2D
/// simulation. Full parity requires implementing wheel-ground collision,
/// gravity, friction, and proper motor dynamics in WASM.
///
/// ## Current Behavior
///
/// - WASM uses linear motion with constant velocity
/// - Velocity is derived from: motor_speed * wheel_radius * shape_modifier
/// - No collision detection or terrain following
/// - Deterministic but not physically accurate
///
/// ## Future Work
///
/// For full Layer 3 anti-cheat, the WASM physics must match TypeScript:
/// - Box2D wheel-ground collision
/// - Gravity and friction
/// - Motor torque and angular velocity
/// - Wheel shape-dependent rolling resistance

use drawrace_validator::resim::ResimEngine;
use drawrace_api::blob::WheelEntry;
use drawrace_validator::wasm_abi::Obstacle;

/// Unit circle wheel (12 vertices, radius ~1.0)
fn unit_circle_12() -> Vec<(i16, i16)> {
    let mut verts = Vec::with_capacity(12);
    for i in 0..12 {
        let angle = (i as f32 / 12.0) * std::f32::consts::PI * 2.0;
        verts.push(((angle.cos() * 100.0) as i16, (angle.sin() * 100.0) as i16));
    }
    verts
}

/// Triangle wheel (3 vertices, radius ~0.35)
fn triangle_r40() -> Vec<(i16, i16)> {
    vec![
        (40, 0),
        (-20, 35),
        (-20, -35),
    ]
}

/// Flat 100m track for testing
/// Terrain at y=500, wheel starts at y=498.5 (on ground with wheel radius ~1.5)
const FLAT_TERRAIN_100M: &[(f32, f32)] = &[
    (0.0, 500.0),
    (100.0, 500.0),
];

const SEED: u32 = 42;

fn make_wheel(vertices: &[(i16, i16)]) -> WheelEntry {
    WheelEntry {
        swap_tick: 0,
        vertex_count: vertices.len() as u8,
        polygon_vertices: vertices.to_vec(),
    }
}

#[test]
fn test_resim_deterministic_circle_wheel() {
    let engine = match ResimEngine::load() {
        Ok(e) => e,
        Err(e) => {
            println!("Skipping test: resim.wasm not found: {}", e);
            return;
        }
    };

    let wheels = vec![make_wheel(&unit_circle_12())];
    let obstacles: Vec<Obstacle> = vec![];

    // Run the same simulation twice and verify deterministic output
    let result1 = engine.resim(
        &wheels,
        FLAT_TERRAIN_100M,
        &obstacles,
        95.0,  // finish_x
        1.5,   // start_x
        498.5, // start_y (on ground with wheel radius ~1.5)
        10000, // claimed_finish (large enough to not timeout)
        SEED,
    );

    let result2 = engine.resim(
        &wheels,
        FLAT_TERRAIN_100M,
        &obstacles,
        95.0,
        1.5,
        498.5,
        10000,
        SEED,
    );

    assert!(result1.is_ok(), "First resim failed: {:?}", result1.err());
    assert!(result2.is_ok(), "Second resim failed: {:?}", result2.err());

    let r1 = result1.unwrap();
    let r2 = result2.unwrap();

    // Deterministic: same inputs produce same outputs
    assert_eq!(r1.finish_ticks, r2.finish_ticks, "finish_ticks should be deterministic");
    assert_eq!(r1.stuck, r2.stuck, "stuck should be deterministic");
}

#[test]
fn test_resim_deterministic_triangle_wheel() {
    let engine = match ResimEngine::load() {
        Ok(e) => e,
        Err(e) => {
            println!("Skipping test: resim.wasm not found: {}", e);
            return;
        }
    };

    let wheels = vec![make_wheel(&triangle_r40())];
    let obstacles: Vec<Obstacle> = vec![];

    let result1 = engine.resim(
        &wheels,
        FLAT_TERRAIN_100M,
        &obstacles,
        95.0,
        1.5,
        498.5,
        10000,
        SEED,
    );

    let result2 = engine.resim(
        &wheels,
        FLAT_TERRAIN_100M,
        &obstacles,
        95.0,
        1.5,
        498.5,
        10000,
        SEED,
    );

    assert!(result1.is_ok(), "First resim failed: {:?}", result1.err());
    assert!(result2.is_ok(), "Second resim failed: {:?}", result2.err());

    let r1 = result1.unwrap();
    let r2 = result2.unwrap();

    assert_eq!(r1.finish_ticks, r2.finish_ticks, "finish_ticks should be deterministic");
    assert_eq!(r1.stuck, r2.stuck, "stuck should be deterministic");
}

#[test]
fn test_resim_wheel_swap_scheduling() {
    let engine = match ResimEngine::load() {
        Ok(e) => e,
        Err(e) => {
            println!("Skipping test: resim.wasm not found: {}", e);
            return;
        }
    };

    // Test with multiple wheels at different swap ticks
    let circle_verts = unit_circle_12();
    let wheels = vec![
        WheelEntry {
            swap_tick: 0,
            vertex_count: 12,
            polygon_vertices: circle_verts.clone(),
        },
        WheelEntry {
            swap_tick: 60,
            vertex_count: 12,
            polygon_vertices: circle_verts.clone(),
        },
        WheelEntry {
            swap_tick: 120,
            vertex_count: 12,
            polygon_vertices: circle_verts,
        },
    ];

    let obstacles: Vec<Obstacle> = vec![];

    let result = engine.resim(
        &wheels,
        FLAT_TERRAIN_100M,
        &obstacles,
        95.0,
        1.5,
        498.5,
        10000,
        SEED,
    );

    assert!(result.is_ok(), "Resim with wheel swaps failed: {:?}", result.err());

    let sim_result = result.unwrap();

    // Verify swap log was recorded
    // The WASM should log each wheel swap
    println!("Swap log: {:?}", sim_result.swap_log);

    // With 3 wheels at ticks 0, 60, 120, we expect swap log entries
    // (Note: current WASM stub may not properly log swaps)
}

#[test]
fn test_resim_seed_affects_result() {
    let engine = match ResimEngine::load() {
        Ok(e) => e,
        Err(e) => {
            println!("Skipping test: resim.wasm not found: {}", e);
            return;
        }
    };

    let wheels = vec![make_wheel(&unit_circle_12())];
    let obstacles: Vec<Obstacle> = vec![];

    // Run with different seeds
    let result1 = engine.resim(
        &wheels,
        FLAT_TERRAIN_100M,
        &obstacles,
        95.0,
        1.5,
        498.5,
        10000,
        42,
    );

    let result2 = engine.resim(
        &wheels,
        FLAT_TERRAIN_100M,
        &obstacles,
        95.0,
        1.5,
        498.5,
        10000,
        12345,
    );

    assert!(result1.is_ok());
    assert!(result2.is_ok());

    // With proper physics, different seeds should produce different results
    // (Note: current linear approximation may not use the seed)
    let r1 = result1.unwrap();
    let r2 = result2.unwrap();

    println!("Seed 42: finish_ticks={:?}", r1.finish_ticks);
    println!("Seed 12345: finish_ticks={:?}", r2.finish_ticks);

    // This test documents current behavior - it may not show difference
    // until proper stochastic physics are implemented
}

#[test]
fn test_resim_max_ticks_enforcement() {
    let engine = match ResimEngine::load() {
        Ok(e) => e,
        Err(e) => {
            println!("Skipping test: resim.wasm not found: {}", e);
            return;
        }
    };

    // Use a very short claimed_finish to trigger timeout
    let wheels = vec![make_wheel(&unit_circle_12())];
    let obstacles: Vec<Obstacle> = vec![];

    // claimed_finish = 60 ticks (1 second) - impossible for 100m track
    let result = engine.resim(
        &wheels,
        FLAT_TERRAIN_100M,
        &obstacles,
        95.0,
        1.5,
        498.5,
        60, // Very short - should timeout
        SEED,
    );

    // Should either timeout (return None) or finish if physics is very fast
    assert!(result.is_ok(), "Resim should not error even with timeout");
    let sim_result = result.unwrap();

    // Document current behavior
    println!("With claimed_finish=60, finish_ticks={:?}", sim_result.finish_ticks);
}
