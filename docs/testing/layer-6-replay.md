# Layer 6: Replay Verification Tests

## Overview

Layer 6 runs pre-recorded real-player ghosts through the server-side re-simulator to detect physics drift. Any divergence from expected finish times fails CI, serving as a determinism regression gate.

## What It Tests

1. **Determinism across environments**: Identical wheel input produces identical finish times on client, server, and test harness
2. **Physics engine stability**: Refactors don't silently change gameplay behavior
3. **Cross-version compatibility**: Engine upgrades maintain backwards compatibility with existing ghosts

## Test Infrastructure

### Location
`crates/validator/tests/replay.rs` — Integration test that loads ghosts from `crates/validator/reference-ghosts.json`

### Ghost Data Format
Each ghost in `reference-ghosts.json` contains:
- `ghost_id`: Unique identifier
- `track_id`: Numeric track ID (1-3 currently)
- `finish_time_ms`: Recorded finish time
- `wheels`: Array of wheel swap entries (swap_tick, vertex_count, polygon_vertices)
- `physics_version`: Physics version when recorded
- `notes`: Metadata

### Test Execution
```bash
# Run replay verification
cargo test -p drawrace-validator --test replay replay_all_reference_ghosts -- --nocapture

# With environment override for custom ghost file
REFERENCE_GHOSTS_PATH=/path/to/custom.json cargo test -p drawrace-validator --test replay
```

### Tolerance
The test allows **2 tick tolerance** for floating-point differences across platforms. Ghosts that diverge beyond this threshold fail the test.

## CI Integration

The test runs automatically in CI via the `drawrace-ci` WorkflowTemplate:

```yaml
- name: replay-verify
  template: step
  dependencies: [unit]
  arguments:
    parameters:
      - {name: cmd, value: "cargo test -p drawrace-validator --test replay"}
```

This step runs in parallel with `physics-golden` after unit tests complete.

## Current Status

The test infrastructure is complete and functional. The current `reference-ghosts.json` contains 201 synthetic test ghosts that serve as placeholders. These synthetic ghosts fail re-simulation because they don't represent real gameplay — the wheel shapes don't correspond to drivable configurations.

### TODO: Populate with Real Ghosts

To enable the regression test as a proper physics drift detector:

1. **Extract real-player ghosts from production database**

   ```sql
   SELECT g.id, g.track_id, g.finish_time_ms, g.wheels
   FROM ghosts g
   JOIN tracks t ON g.track_id = t.id
   WHERE t.numeric_id IN (1, 2, 3)
   ORDER BY g.finish_time_ms ASC
   LIMIT 200;
   ```

2. **Convert to reference-ghosts.json format** using the existing structure

3. **Verify all 200 ghosts pass re-simulation** locally before committing

## Track Coverage

Current track store (`apps/web/public/tracks/`):
- Track 1: hills-01.json (Scribble Slope)
- Track 2: canyon-02.json
- Track 3: dunes-03.json

Ghosts should only reference these track IDs (1, 2, 3) until more tracks are added.

## Failure Diagnostics

When a ghost fails re-simulation, the test reports:
- **Timeout**: Ghost didn't finish within expected ticks (wheels are undrivable)
- **Tick mismatch**: Resim finish time differs from recorded time (physics drift)

Example output:
```
=== Replay Verification Results ===
Total: 201
Passed: 199
Failed: 2

Failures:
  - ghost-abc123: tick mismatch: expected 960, got 963, diff = 3
  - ghost-def456: resim did not finish within timeout (expected 16000ms / 960 ticks)
```

## Physics Version Bumps

When intentionally changing physics behavior:
1. Bump `physics_version` in `engine-core`
2. Regenerate all golden files (Layer 2)
3. Re-record all reference ghosts
4. Update `reference-ghosts.json` with new version and ghosts
5. Roll out server first, then client

This ensures old clients remain compatible until server upgrade completes.

## References

- Implementation: `crates/validator/tests/replay.rs`
- Ghost data: `crates/validator/reference-ghosts.json`
- Resim engine: `crates/validator/src/resim.rs`
- Test README: `crates/validator/tests/README.md`
- Plan: `docs/plan/plan.md` §Testing 6
