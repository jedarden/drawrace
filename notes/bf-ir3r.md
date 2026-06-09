# bf-ir3r: WASM Physics Integration for Live Racing

## Summary

The WASM physics integration for drawrace-live has been completed. This replaces the placeholder linear-motion stub with actual WASM resim integration, enabling the live racing feature to run real races.

## What Was Implemented

### Physics Module (`crates/live/src/physics/`)

1. **wasm_engine.rs** - WASM physics engine wrapper
   - Loads `resim.wasm` at startup via wasmtime
   - Each racer gets their own WASM instance for independent state tracking
   - Proper WASM ABI for initialization and state reading
   - Supports wheel swaps, terrain, obstacles, and finish line detection

2. **track.rs** - Track data loading
   - Loads track JSON files from versioned track store
   - Converts terrain and obstacles to WASM format
   - Caches loaded tracks by numeric_id

3. **mod.rs** - Race simulation orchestration
   - `RaceSimulator` manages per-racer WASM instances
   - `RaceExecutor` runs authoritative simulation for all active races
   - `GlobalPhysicsEngine` singleton loads WASM and track store at startup

### Application Integration

4. **main.rs** - Physics engine initialization
   - Loads `GlobalPhysicsEngine` with tracks directory
   - Logs physics version and track count at startup

5. **app.rs** - State management
   - `LiveState` holds physics engine and race executor
   - `RaceExecutor` created with engine and track_store

6. **background.rs** - 30Hz race loop
   - `run_race_loop` steps all active races at ~30Hz (33ms intervals)
   - Broadcasts state updates to all players in each room

## Verification

- [x] WASM physics module loads resim.wasm at startup
- [x] TrackStore loads track JSON files and converts to WASM format
- [x] RaceSimulator uses per-racer WASM instances
- [x] RaceExecutor steps races at 30Hz fixed step
- [x] State broadcasts {racer_id, x, y, angle, t} for 2-8 racers
- [x] Proper initialization flow in main.rs/app.rs
- [x] Build succeeds

## Related TODOs (Separate Beads)

The following TODOs exist in other modules but are separate concerns:

- **ghost.rs**: Ghost fetching from S3/API (lines 41, 56)
- **websocket.rs**: Bucket lookup from leaderboard API (line 197)

These should be addressed in their own beads.

## Commit

d2a93b6 feat(bf-ir3r): implement WASM physics integration for live racing
