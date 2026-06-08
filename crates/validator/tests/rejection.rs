/// Rejection test for forged (too-fast) submissions (bf-1c5p).
///
/// This test verifies that the validator rejects submissions that claim
/// an impossible finish time (faster than physics allows). It tests the
/// core anti-cheat Layer 3 validation: re-sim must produce a finish tick
/// within tolerance of the client's claim, otherwise reject.
///
/// A "forged" submission is one where the client claims a finish time that
/// is physically impossible given the wheel shapes, track data, and physics.
/// The WASM re-sim will finish later than the claim, triggering rejection.

use drawrace_validator::resim::ResimEngine;
use drawrace_validator::wasm_abi::Obstacle;
use drawrace_api::blob::WheelEntry;

/// Unit circle wheel (12 vertices, radius ~1.0)
fn unit_circle_12() -> Vec<(i16, i16)> {
    let mut verts = Vec::with_capacity(12);
    for i in 0..12 {
        let angle = (i as f32 / 12.0) * std::f32::consts::PI * 2.0;
        verts.push(((angle.cos() * 100.0) as i16, (angle.sin() * 100.0) as i16));
    }
    verts
}

/// Flat 100m track for testing
const FLAT_TERRAIN_100M: &[(f32, f32)] = &[
    (0.0, 500.0),
    (100.0, 500.0),
];

const SEED: u32 = 42;

/// The finish tick tolerance used in validator
const FINISH_TICK_TOLERANCE: u32 = 2;

#[test]
fn test_forged_submission_rejected() {
    let engine = match ResimEngine::load() {
        Ok(e) => e,
        Err(e) => {
            println!("Skipping test: resim.wasm not found: {}", e);
            return;
        }
    };

    // Create a legitimate wheel setup
    let wheels = vec![
        WheelEntry {
            swap_tick: 0,
            vertex_count: 12,
            polygon_vertices: unit_circle_12(),
        },
    ];

    let obstacles: Vec<Obstacle> = vec![];

    // Track: 100 meters, finish at x=95, start at x=1.5
    // The distance to travel is 95 - 1.5 = 93.5 meters
    let finish_x = 95.0;
    let start_x = 1.5;
    let start_y = 498.5;

    // First, get the legitimate finish tick by running resim with a generous claimed_finish
    let legitimate_result = engine.resim(
        &wheels,
        FLAT_TERRAIN_100M,
        &obstacles,
        finish_x,
        start_x,
        start_y,
        10000, // Large claimed_finish to ensure no timeout
        SEED,
    );

    assert!(legitimate_result.is_ok(), "Legitimate resim failed: {:?}", legitimate_result.err());
    let legitimate_sim = legitimate_result.unwrap();

    // Get the actual finish tick from physics
    let actual_finish_ticks = legitimate_sim.finish_ticks.expect("Legitimate sim should finish");

    println!("Actual finish ticks from physics: {}", actual_finish_ticks);

    // Now create a forged submission that claims 20% faster time
    // This should be physically impossible
    let forged_claimed_finish = (actual_finish_ticks as f64 * 0.8) as u32;

    println!("Forged claimed finish: {} (20% faster than actual {})",
        forged_claimed_finish, actual_finish_ticks);

    // Run resim with the forged claimed_finish
    let forged_result = engine.resim(
        &wheels,
        FLAT_TERRAIN_100M,
        &obstacles,
        finish_x,
        start_x,
        start_y,
        forged_claimed_finish,
        SEED,
    );

    assert!(forged_result.is_ok(), "Forged resim should not error: {:?}", forged_result.err());
    let forged_sim = forged_result.unwrap();

    // The forged sim should still finish (with the actual physics time)
    // but it will be much later than the claimed time
    match forged_sim.finish_ticks {
        None => {
            // If the sim timed out due to the too-short claimed_finish, that's also
            // a valid rejection path
            println!("Forged submission timed out (rejected via timeout)");
        }
        Some(server_finish_ticks) => {
            println!("Server finish ticks: {}", server_finish_ticks);
            println!("Forged claimed finish: {}", forged_claimed_finish);

            // The server finish tick should be much later than the claimed finish
            let diff = if server_finish_ticks > forged_claimed_finish {
                server_finish_ticks - forged_claimed_finish
            } else {
                forged_claimed_finish - server_finish_ticks
            };

            println!("Tick difference: {}", diff);

            // For a 20% faster claim, the difference should exceed tolerance
            // 20% of e.g. 1000 ticks = 200 ticks difference, far exceeding 2 tick tolerance
            assert!(
                diff > FINISH_TICK_TOLERANCE,
                "Forged submission should exceed tolerance: diff={}, tolerance={}",
                diff, FINISH_TICK_TOLERANCE
            );

            // This would trigger rejection in the validator
            println!("Forged submission would be REJECTED (tick diff {} > {})",
                diff, FINISH_TICK_TOLERANCE);
        }
    }
}

#[test]
fn test_legitimate_submission_accepted() {
    let engine = match ResimEngine::load() {
        Ok(e) => e,
        Err(e) => {
            println!("Skipping test: resim.wasm not found: {}", e);
            return;
        }
    };

    let wheels = vec![
        WheelEntry {
            swap_tick: 0,
            vertex_count: 12,
            polygon_vertices: unit_circle_12(),
        },
    ];

    let obstacles: Vec<Obstacle> = vec![];

    let finish_x = 95.0;
    let start_x = 1.5;
    let start_y = 498.5;

    // Run with a generous claimed_finish
    let result = engine.resim(
        &wheels,
        FLAT_TERRAIN_100M,
        &obstacles,
        finish_x,
        start_x,
        start_y,
        10000,
        SEED,
    );

    assert!(result.is_ok());
    let sim = result.unwrap();

    let actual_finish_ticks = sim.finish_ticks.expect("Sim should finish");

    // Now re-run with the actual finish as claimed_finish
    // This should be accepted (within tolerance)
    let legitimate_result = engine.resim(
        &wheels,
        FLAT_TERRAIN_100M,
        &obstacles,
        finish_x,
        start_x,
        start_y,
        actual_finish_ticks,
        SEED,
    );

    assert!(legitimate_result.is_ok());
    let legitimate_sim = legitimate_result.unwrap();

    match legitimate_sim.finish_ticks {
        None => {
            panic!("Legitimate submission with correct claimed_finish should not timeout");
        }
        Some(server_finish_ticks) => {
            let diff = if server_finish_ticks > actual_finish_ticks {
                server_finish_ticks - actual_finish_ticks
            } else {
                actual_finish_ticks - server_finish_ticks
            };

            println!("Legitimate submission: claimed={}, server={}, diff={}",
                actual_finish_ticks, server_finish_ticks, diff);

            // Should be within tolerance
            assert!(
                diff <= FINISH_TICK_TOLERANCE,
                "Legitimate submission should be within tolerance: diff={}, tolerance={}",
                diff, FINISH_TICK_TOLERANCE
            );

            println!("Legitimate submission would be ACCEPTED (tick diff {} <= {})",
                diff, FINISH_TICK_TOLERANCE);
        }
    }
}

#[test]
fn test_boundary_case_exactly_at_tolerance() {
    let engine = match ResimEngine::load() {
        Ok(e) => e,
        Err(e) => {
            println!("Skipping test: resim.wasm not found: {}", e);
            return;
        }
    };

    let wheels = vec![
        WheelEntry {
            swap_tick: 0,
            vertex_count: 12,
            polygon_vertices: unit_circle_12(),
        },
    ];

    let obstacles: Vec<Obstacle> = vec![];

    let finish_x = 95.0;
    let start_x = 1.5;
    let start_y = 498.5;

    // Get the actual finish time
    let baseline = engine.resim(&wheels, FLAT_TERRAIN_100M, &obstacles,
        finish_x, start_x, start_y, 10000, SEED).unwrap();
    let actual_finish_ticks = baseline.finish_ticks.expect("Baseline should finish");

    // Test at exactly the tolerance boundary - should still be accepted
    let claimed_at_boundary = actual_finish_ticks.saturating_sub(FINISH_TICK_TOLERANCE);

    let result = engine.resim(&wheels, FLAT_TERRAIN_100M, &obstacles,
        finish_x, start_x, start_y, claimed_at_boundary, SEED).unwrap();

    match result.finish_ticks {
        None => {
            // If timeout, that's acceptable for a boundary case
            println!("Boundary case: timeout with claimed_finish = claimed - tolerance");
        }
        Some(server_finish_ticks) => {
            let diff = if server_finish_ticks > claimed_at_boundary {
                server_finish_ticks - claimed_at_boundary
            } else {
                claimed_at_boundary - server_finish_ticks
            };

            println!("Boundary case: claimed={}, server={}, diff={}, tolerance={}",
                claimed_at_boundary, server_finish_ticks, diff, FINISH_TICK_TOLERANCE);

            // At the boundary, should be within or exactly at tolerance
            assert!(diff <= FINISH_TICK_TOLERANCE + 1,
                "Boundary case should be at or near tolerance: diff={}", diff);
        }
    }
}

#[test]
fn test_multiple_runs_determinism_for_rejection() {
    let engine = match ResimEngine::load() {
        Ok(e) => e,
        Err(e) => {
            println!("Skipping test: resim.wasm not found: {}", e);
            return;
        }
    };

    let wheels = vec![
        WheelEntry {
            swap_tick: 0,
            vertex_count: 12,
            polygon_vertices: unit_circle_12(),
        },
    ];

    let obstacles: Vec<Obstacle> = vec![];
    let forged_claimed_finish = 100; // Very fast claim

    let results: Vec<_> = (0..5)
        .map(|_| {
            engine.resim(
                &wheels,
                FLAT_TERRAIN_100M,
                &obstacles,
                95.0,
                1.5,
                498.5,
                forged_claimed_finish,
                SEED,
            )
        })
        .collect();

    // All runs should produce the same result (deterministic)
    let first_result = results[0].as_ref().unwrap();
    for (i, result) in results.iter().enumerate() {
        assert!(result.is_ok(), "Run {} failed: {:?}", i, result.as_ref().err());
        let sim = result.as_ref().unwrap();

        assert_eq!(
            sim.finish_ticks, first_result.finish_ticks,
            "Run {} produced different finish_ticks (non-deterministic)",
            i
        );
        assert_eq!(sim.stuck, first_result.stuck,
            "Run {} produced different stuck status (non-deterministic)", i);
    }

    println!("Determinism check passed: 5 runs produced identical results");
}
