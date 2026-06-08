# bf-1c5p: Re-sim 3/3 - WASM Re-sim Integration Complete

## Overview

Completed the third and final phase of bf-35ry: replacing `run_resim_stub` with real WASM re-simulation, including comprehensive rejection tests and determinism verification.

## Acceptance Criteria Met

✅ **Recorded ghosts re-simulate to same finish ticks**
   - `crates/validator/tests/replay.rs`: `replay_all_reference_ghosts` test
   - Verifies 47 reference ghosts replay deterministically to their recorded finish ticks

✅ **Forged (too-fast) submissions are rejected**
   - `crates/validator/tests/rejection.rs`: comprehensive rejection test suite
   - Tests: `test_forged_submission_rejected`, `test_legitimate_submission_accepted`
   - Validates that submissions claiming impossible finish times exceed tolerance

✅ **Determinism holds across runs**
   - `crates/validator/tests/resim_roundtrip.rs`: determinism test suite
   - Tests: `test_resim_deterministic_*`, `test_multiple_runs_determinism_for_rejection`
   - Verifies identical inputs produce identical outputs across multiple runs

## Implementation Details

### Core Changes
- `crates/validator/src/main.rs`: Integrated `ResimEngine` for real re-sim
- `crates/validator/src/resim.rs`: WASM re-sim engine wrapper
- `crates/validator/src/wasm_abi.rs`: WASM ABI definitions for wheel/track data

### Test Coverage
- 66 total tests passing (15 lib, 40 main, 4 rejection, 2 replay, 5 roundtrip)
- Rejection tests cover tolerance boundaries and edge cases
- Determinism tests verify seed consistency and multi-run stability

### Anti-Cheat Layer 3
The re-sim validator now enforces Layer 3 anti-cheat:
1. Client submits finish time claim with ghost data
2. Server re-simulates using WASM physics engine
3. Server compares re-sim finish ticks with client claim
4. If difference > `FINISH_TICK_TOLERANCE` (2 ticks), submission rejected

## Commits

- `3b97bf0`: Finalize WASM re-sim integration
- `45884e9`: Add rejection tests for forged submissions

## Retrospective

**What worked:** Building incrementally on bf-609d (WASM ABI) and bf-3ht9 (roundtrip) made integration straightforward. The test-first approach for rejection tests ensured clear acceptance criteria.

**What didn't:** Initial confusion about tick output format required debug tooling (`scripts/debug-resim-tick-output.rs`) to understand WASM return values.

**Surprise:** The 2-tick tolerance is tighter than expected but necessary for robust anti-cheat without false positives on legitimate submissions.

**Reusable pattern:** For physics-validated features, create deterministic roundtrip tests first, then build the validator around them. This ensures the validation logic matches actual physics behavior.
