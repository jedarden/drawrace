# Bead bf-35ry: Validator WASM Re-simulation Implementation

## Status: COMPLETE

This bead tracked the implementation of real validator re-simulation using engine-core WASM via wasmtime.

## Implementation Summary

The work was completed in sub-task `bf-1c5p` (closed) with commit `3b97bf0` on 2026-06-08.

### Key Components

1. **`crates/validator/src/resim.rs`**: `ResimEngine` struct
   - Loads `resim.wasm` via wasmtime
   - Validates required exports (physics_version, resim_init, resim_step, etc.)
   - `resim()` method runs full re-simulation with wheel swaps
   - `resim_with_state()` returns full simulation state for debugging

2. **`crates/validator/src/main.rs`**: Integration into validation flow
   - Loads `ResimEngine` at line 357
   - Runs re-simulation at line 375
   - Compares server vs client finish ticks with 2-tick tolerance (line 408-428)
   - Rejects forged submissions that don't match

3. **`crates/validator/src/wasm_abi.rs`**: Memory ABI for WASM communication
   - Defines memory layout for wheels, terrain, obstacles, simulation state
   - `init_memory()`: writes simulation data to WASM memory
   - `read_result()`: reads finish_ticks from WASM memory
   - `read_state()`: reads full simulation state

### WASM Artifact

- Location: `packages/engine-core/dist/resim.wasm`
- Physics version: 4
- Size: ~1.2KB (minimal TypeScript re-sim module)

### Test Coverage

All 47 tests pass, including:
- `forged_too_fast_submission_rejected`: forged times rejected
- `slightly_fast_within_tolerance_accepted`: 2-tick tolerance works
- `test_resim_deterministic_*`: determinism holds across runs
- `single_wheel_resim_accepted`, `five_swap_resim_accepted`: various swap patterns

### What Was Replaced

The task mentioned `run_resim_stub` which returned `claimed_finish_ticks` verbatim. This stub was replaced with:
- Real WASM loading via `wasmtime`
- Actual physics re-simulation matching client behavior
- Deterministic tick-based validation

## Dependencies

- `wasmtime` crate (v30) in `Cargo.toml`
- `resim.wasm` built from `packages/engine-core/src/wasm-resim.ts`
- Track data loaded from `apps/web/public/tracks/`

## References

- Commit: `3b97bf0` - "feat(bf-1c5p): finalize WASM re-sim integration with rejection/determinism tests"
- Bead: `bf-1c5p` - "Re-sim 3/3: replace run_resim_stub with real WASM re-sim"
- Plan: Multiplayer §Layer 3 (~L412-424), Testing §Layer 6
