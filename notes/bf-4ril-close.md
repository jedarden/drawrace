# WASM ABI Completion (bf-4ril)

## Summary

The WASM ABI for re-simulation (bf-609d + bf-3ht9) is **COMPLETE** and working correctly. This bead represented the remaining ABI completion needed to make the full validator re-simulation pipeline real.

## What Was Completed

### bf-609d: Invoke Sim Entrypoint and Read Finish Ticks ✓ COMPLETE

The `ResimEngine` in `crates/validator/src/resim.rs` has full implementation:

1. `resim_init()` - Initializes simulation from WASM memory
2. `resim_step()` loop - Runs simulation until completion or timeout
3. `read_result()` - Reads finish_ticks and stuck status from result region

### bf-3ht9: Round-trip Parity Test ✓ COMPLETE

The `crates/validator/tests/resim_roundtrip.rs` test suite verifies:

- Determinism: same inputs produce same outputs (circle wheel, triangle wheel)
- Wheel swap scheduling: multiple wheels at different swap ticks
- Seed variation: different seeds produce different results
- Max ticks enforcement: timeout behavior

### Validator Integration ✓ COMPLETE

The validator main.rs (lines 342-431) has full Layer 3 re-simulation:

1. Loads WASM resim engine
2. Runs re-simulation with ghost wheels, terrain, obstacles
3. Compares resim finish_ticks to client's claimed finish
4. Rejects if difference exceeds tolerance
5. Handles stuck/timeout cases

## Tests Passing

All tests pass:
- `resim::tests::load_resim_wasm` - passing
- `resim::tests::test_simple_resim` - passing
- `test_resim_deterministic_circle_wheel` - passing
- `test_resim_deterministic_triangle_wheel` - passing
- `test_resim_wheel_swap_scheduling` - passing
- `test_resim_seed_affects_result` - passing
- `test_resim_max_ticks_enforcement` - passing

## Retrospective

- **What worked:** The ABI implementation was already complete from prior work (commits 2c9eea2, c21500b)
- **What didn't:** N/A - implementation was correct from the start
- **Surprise:** The beads remained open despite the functionality being complete and tested
- **Reusable pattern:** For WASM ABI tasks: verify functionality exists, write tests, close beads

## Files

No files modified - this task closed beads for already-complete work.
