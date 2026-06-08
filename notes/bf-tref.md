# Layer 6 Replay Test - Analysis Summary

**Bead**: bf-tref
**Date**: 2026-06-08
**Status**: Code implementation complete; awaiting production data

## Task: Add Layer 6 replay test crate with 200 pre-recorded ghosts

**Bead Description Claims**:
- crates/validator/tests/ does not exist
- Status doc falsely marks Layer 6 COMPLETE
- Requires 200 pre-recorded real-player ghosts

**Actual State**:
- ✅ crates/validator/tests/replay.rs EXISTS (289 lines, comprehensive implementation)
- ✅ Status docs are ACCURATE (PROGRESS.md: "Implemented", project-status.md: "⚠️ PARTIAL")
- ⚠️ 201 ghosts exist but are SYNTHETIC (not real-player)

## Current State Assessment

## Current State Assessment

### Test Infrastructure: ✅ COMPLETE
- **File**: `crates/validator/tests/replay.rs` (290 lines)
- **Functionality**: Comprehensive replay verification test that:
  - Loads reference ghosts from `reference-ghosts.json`
  - Runs WASM re-simulation for each ghost
  - Verifies finish times within ±2 tick tolerance
  - Tracks pass/fail counts and reports failures
- **Test functions**:
  - `replay_all_reference_ghosts()` - Main test
  - `test_load_reference_ghosts()` - File loading test

### Reference Ghosts File: ✅ EXISTS (201 ghosts)
- **File**: `crates/validator/reference-ghosts.json`
- **Count**: 201 ghosts (exceeds 200 target)
- **Status**: All are **synthetic test ghosts** (not from real players)
- **Naming pattern**: `synth-track-1-000`, `synth-track-1-001`, etc.
- **Notes content**: "Synthetic test ghost - track X, seed Y. Single wheel for stability. Replace with real-player ghosts from production."

### Status Documentation: ✅ ACCURATE
- **File**: `docs/status/project-status.md`
- **Layer 6 Status**: `⚠️ PARTIAL` (not marked COMPLETE)
- **Note**: "Test infrastructure complete, awaiting 200 real-player ghosts from production (currently using 201 synthetic placeholders)"

## Gap Analysis

The task description contains several inaccuracies:
1. ❌ "crates/validator/tests/ does not exist" → **FALSE**, directory exists with comprehensive tests
2. ❌ "Status doc falsely marks Layer 6 COMPLETE" → **FALSE**, correctly marked PARTIAL

### The Real Gap
**Missing: Real-player ghosts from production**

The 201 existing ghosts are synthetic placeholders generated with seeds. Replacing them with real-player ghosts requires:
1. Game deployed to production
2. Real players submitting runs
3. Extraction mechanism to convert production runs to reference ghosts
4. Curation process to select 200 representative ghosts

This is an **operational task**, not a code implementation task.

## Dependencies

- ✅ WASM re-simulation (Phase 3) - Complete
- ✅ Test infrastructure - Complete
- ❌ Production player data - Missing (operational)

## Recommendation

The Layer 6 replay test **code implementation is complete**. The remaining work is:
1. Deploy game to production
2. Collect real-player ghost data
3. Curate and replace synthetic ghosts with real ones
4. Update reference-ghosts.json notes to reflect source

No code changes are required for this task.
