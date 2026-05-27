# Layer 6 Replay Verification Tests

## Overview

This directory contains the replay verification test infrastructure for Layer 6 determinism checking.

## Files

- **replay.rs**: Integration test that runs pre-recorded ghosts through the re-simulator
- **reference-ghosts.json**: Reference ghost data for regression testing

## Current Status

The test infrastructure is complete and functional, but **the test is currently skipped** because we need real-player ghost data.

### What Works

1. Test infrastructure exists in `replay.rs`
2. Reference ghost file format is defined
3. Track loading from `/public/tracks/` works
4. Re-simulation engine loads and executes
5. CI integration via `cargo test --workspace` in drawrace-build workflow

### What's Missing

**Real-player ghosts from production.** The current `reference-ghosts.json` contains synthetic test data that does not represent actual gameplay. These synthetic ghosts fail re-simulation because:

- The wheel shapes don't correspond to drivable configurations
- The finish times are unrealistic for the tracks
- The wheel swap schedules don't match actual physics progression

## How to Populate Real Ghosts

To enable the regression test:

1. **Extract real-player ghosts from production database**

   ```sql
   SELECT g.id, g.track_id, g.finish_time_ms, g.wheels
   FROM ghosts g
   JOIN tracks t ON g.track_id = t.id
   WHERE t.numeric_id IN (1, 2, 3)  -- Only tracks that exist in track store
   ORDER BY g.finish_time_ms ASC
   LIMIT 200;
   ```

2. **Convert to reference-ghosts.json format**

   Each ghost needs:
   - `ghost_id`: Unique identifier
   - `track_id`: Numeric track ID (1, 2, or 3 currently)
   - `finish_time_ms`: Finish time in milliseconds
   - `wheels`: Array of wheel swap entries
   - `physics_version`: Physics engine version when recorded
   - `notes`: Optional metadata

3. **Run the test**

   ```bash
   cargo test -p drawrace-validator --test replay replay_all_reference_ghosts
   ```

## Test Behavior

When properly populated with real ghosts:

1. Loads 200 pre-recorded ghosts from `reference-ghosts.json`
2. Loads track data for each ghost's track ID
3. Re-simulates each ghost through the WASM physics engine
4. Compares resim finish time to recorded finish time
5. Allows 2-tick tolerance for floating-point differences
6. Fails CI if any ghost diverges beyond tolerance

## CI Integration

The test runs automatically in CI via the `drawrace-build` WorkflowTemplate:

```yaml
# In drawrace-build-workflowtemplate.yml
- name: test
  template: run-tests
  container:
    command: [sh, -c]
    args:
      - |
        cargo test --workspace --all-features  # Includes replay tests
```

## Track Coverage

Current track store (`apps/web/public/tracks/`):
- Track 1: hills-01.json (Scribble Slope)
- Track 2: canyon-02.json
- Track 3: dunes-03.json

Ghosts should only reference these track IDs (1, 2, 3) until more tracks are added.

## Determinism Guarantee

The purpose of this test is to catch **physics drift** - any change to the physics engine that causes replayed ghosts to finish at different times. This ensures:

1. Physics updates remain deterministic across platforms
2. Refactors don't silently change gameplay behavior
3. Engine version upgrades maintain backwards compatibility

## TODO

- [ ] Extract 200 real-player ghosts from production
- [ ] Populate `reference-ghosts.json` with real data
- [ ] Verify all 200 ghosts pass re-simulation
- [ ] Add CI status badge showing test results
- [ ] Consider adding per-track ghost subsets for targeted testing
