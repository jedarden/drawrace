# Stuck-DNF Detection - Already Implemented

Bead bf-2erb was created to implement stuck-DNF detection in race-sim, but this feature was already completed in commit b08f681.

## Implementation (already present in race-sim.ts)

The stuck-DNF detection is implemented at lines 308-323 of `packages/engine-core/src/race-sim.ts`:

1. **Rotation counter**: `Σ(|ω_front| + |ω_rear|) × dt / (2π × 2)` per tick
2. **DNF trigger**: 10 full rotations without advancing chassis.x by >0.5m
3. **Progress baseline reset**: On wheel swap (line 255) and when progress ≥0.5m (line 319)
4. **State variables**: `accumulatedRotations` and `progressBaselineX` (lines 74-75)

All 187 tests pass, confirming the implementation works correctly.

## Retrospective
- **What worked:** Checked git log to confirm feature was already complete before starting implementation
- **What didn't:** N/A - no implementation needed
- **Surprise:** The bead task was based on outdated state; the feature had been completed in a prior commit
- **Reusable pattern:** Always verify current git state (git log HEAD) before implementing, as beads may be created from stale issue descriptions
