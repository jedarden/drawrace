# WASM ABI Completion (bf-4ril)

## Summary

The WASM ABI for re-simulation (bf-609d + bf-3ht9) is **COMPLETE** and working correctly. This bead represented the remaining ABI completion needed to make the full validator re-sim pipeline real.

## What Was Verified

### bf-609d: Invoke Sim Entrypoint and Read Finish Ticks ✓ COMPLETE

The `ResimEngine` in `crates/validator/src/resim.rs` has full implementation:

1. `resim_init()` - Initializes simulation from WASM memory (line 179-191)
2. `resim_step()` loop - Runs simulation until completion or timeout (line 183-209)
3. `read_result()` - Reads finish_ticks and stuck status from result region (line 212)

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
4. Rejects if difference exceeds tolerance (2 ticks)
5. Handles stuck/timeout cases

## Retrospective

- **What worked:** The ABI implementation was already complete from prior work. Core functionality (invoke, read, roundtrip) works as designed.
- **What didn't:** Bead descriptions became outdated as sub-beads (bf-609d, bf-3ht9) closed; this verification task identified the discrepancy.
- **Surprise:** The bead remained in_progress despite all dependencies being closed and the functionality complete.
- **Reusable pattern:** For multi-bead chains: verify all sub-beads are closed before closing the parent bead; use `br show` to check actual status vs description.

## Files Modified

No files modified - this task verified and closed beads for already-complete work.
