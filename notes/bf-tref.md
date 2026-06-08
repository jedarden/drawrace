# Layer 6 Replay Verification Status

**Bead:** bf-tref
**Date:** 2026-06-08

## Current State

The Layer 6 replay verification test infrastructure exists and is functional, but the status documentation incorrectly marked it as COMPLETE. This has been corrected to PARTIAL.

### What's Complete ✅

1. **Test Infrastructure**: `crates/validator/tests/replay.rs` exists and works
2. **Ghost Data Format**: `reference-ghosts.json` format is defined and documented
3. **Resim Engine**: WASM re-simulation loads and executes correctly
4. **Track Loading**: Track store loads from `apps/web/public/tracks/`
5. **CI Integration**: Tests run via `cargo test --workspace`

### What's Missing ❌

**200 pre-recorded real-player ghosts from production**

The current `reference-ghosts.json` contains **201 synthetic test ghosts** (not 402 as initially counted - the earlier grep was counting lines). These synthetic ghosts:
- Are generated with regular polygon shapes
- Have finish times estimated from simple physics formulas
- Do NOT represent real gameplay or drivable configurations
- Serve only as placeholders to test the infrastructure

## Requirements Per Plan

From `docs/plan/plan.md` §Testing 7:

> "A dedicated test crate (`crates/validator/tests/replay.rs`) runs 200 pre-recorded **real-player** ghosts through the verifier every commit; any divergence fails CI."

The plan explicitly requires **real-player ghosts**, not synthetic ones.

## Why Real Ghosts Matter

Synthetic ghosts fail to serve as a proper regression suite because:

1. **Not Drivable**: The wheel shapes (regular polygons) don't represent actual player drawings
2. **No Physics Validation**: Finish times are estimated, not from actual simulation
3. **No Real-World Coverage**: They don't cover edge cases from actual gameplay (e.g., extreme concavity, self-intersection, mid-race swaps)

## How to Complete This Work

### Option 1: Extract from Production (Recommended)

1. Access the production database
2. Extract 200 real player ghosts:

```sql
SELECT g.id, g.track_id, g.finish_time_ms, g.wheels
FROM ghosts g
JOIN tracks t ON g.track_id = t.id
WHERE t.numeric_id IN (1, 2, 3)
  AND g.physics_version = 4  -- Current version
ORDER BY g.finish_time_ms ASC
LIMIT 200;
```

3. Convert to `reference-ghosts.json` format
4. Verify all 200 ghosts pass re-simulation locally
5. Commit and push

### Option 2: Record Test Ghosts Locally

If production access is unavailable:

1. Use the live app to record 200 complete runs
2. Extract the ghost blobs from IndexedDB
3. Convert to `reference-ghosts.json` format
4. Verify with re-simulation
5. Commit

## Files Modified

- `docs/status/project-status.md`: Updated Layer 6 status from COMPLETE to PARTIAL

## Next Steps

1. **Immediate**: This bead documents the current state accurately
2. **Phase 3**: When production database is accessible, extract 200 real ghosts
3. **Verification**: Run the replay test with real ghosts to ensure they all pass

## References

- Test implementation: `crates/validator/tests/replay.rs`
- Ghost data: `crates/validator/reference-ghosts.json`
- Test README: `crates/validator/tests/README.md`
- Plan: `docs/plan/plan.md` §Testing 7
