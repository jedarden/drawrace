# Layer 6 Replay Verification Tests

## Overview

This directory contains the replay verification test infrastructure for Layer 6
determinism checking (plan.md §Testing Layer 6). Every commit, the validator
re-simulates a committed corpus of drivable ghosts through the same physics WASM
the live game uses and asserts each one finishes within the 2-tick replay
tolerance. Any divergence fails CI — the determinism regression gate.

## Files

- **replay.rs**: Integration test (`replay_all_reference_ghosts`) that loads the
  corpus and runs every ghost through the re-simulator.
- **reference-ghosts.json** (at `crates/validator/reference-ghosts.json`): The
  regression corpus the test loads. **Generated, never hand-edited** — see
  [Regenerating the fixtures](#regenerating-the-fixtures).

## Current Status

**The test runs and gates CI.** With the committed fixtures it reports
`Total: 216 / Passed: 216 / Failed: 0` (72 physics-derived ghosts per track × 3
tracks). It is not skipped. (The test does contain soft-skip branches that
no-op when `reference-ghosts.json` is absent, `resim.wasm` is unbuilt, or the
track store fails to load — so a cold checkout without a WASM build degrades
gracefully rather than panicking. On a normally-built workspace the corpus is
present and the test runs in full.)

### What Works

1. Test infrastructure in `replay.rs` (`replay_all_reference_ghosts`).
2. Reference ghost corpus committed and populated (216 ghosts, all passing).
3. Track loading from `apps/web/public/tracks/` works for tracks 1/2/3.
4. Re-simulation engine (`ResimEngine`) loads the WASM and executes the same
   physics the client runs.
5. 2-tick replay tolerance enforced; any diverging ghost fails the test.
6. CI integration via the `test-validator` step of the `drawrace-build`
   WorkflowTemplate (`cargo test -p drawrace-validator`).

### What's Missing

**Nothing blocks the gate today.** The corpus is populated and green. The only
open items are enhancements, not gaps (see [TODO](#todo)): a CI status badge,
optional per-track test subsets, and — eventually — re-sourcing the corpus from
real production ghosts once the backend is actually deployed (see
[Re-sourcing from Production (deferred)](#re-sourcing-from-production-deferred)).

## Where the fixtures come from

The corpus is **physics-derived, not hand-picked and not from production**. It is
regenerated deterministically from source by the in-tree generator
**`crates/validator/src/bin/generate-reference-ghosts.rs`**, which draws on two
real, drivable, in-repo wheel sources:

1. **The seed-ghost pool** — `seeds/track_{1,2,3}/*.blob`, the committed output
   of the seed-ghost generator (`crates/api/src/bin/generate-seed-ghosts*`).
   These are the canonical drivable wheel shapes the game ships as its seed pool
   across skill buckets.
2. **The champion parametric family** — the circles / ovals / regular polygons /
   rounded stars that the ML-driven champion search explores
   (`crates/validator/src/champion.rs`, plan.md §Testing 13). These cover the
   drivable shape space the seed pool alone does not span.

Critially, the seed blobs ship with *hand-picked* `finish_time_ms` constants.
The generator **ignores those constants** and instead runs every wheel through
the real physics engine (`ResimEngine::resim`, the same WASM this test
re-simulates with, seed 42) to produce a *physics-derived* `finish_time_ms`.
Each wheel is then round-tripped through the DRGH binary blob format
(`drawrace_api::blob::{BlobHeader, GhostBlob}`) before emission. So every
ghost's finish time is the genuine re-sim result for that shape — a hand-picked
time cannot drift, and a physics-derived one can, which is the whole point of a
drift gate. The corpus contains no `synth-track-*` keys and no constant-time
synthetic entries.

## Regenerating the fixtures

The committed regeneration command (added in the generator commit) is the single
way to rebuild the corpus:

```bash
cargo run -p drawrace-validator --bin generate-reference-ghosts
```

Re-runs are deterministic (seeded LCG, fixed resim seed 42), so the output is
regenerable from source — every ghost, polygon, and finish time is bit-identical
across runs except for `updated_at`. After any intentional physics change, bump
`PHYSICS_VERSION` (`packages/engine-core/src/version.ts`), rebuild the WASM, and
re-run this command to refresh the corpus at the new version. Never hand-edit
`reference-ghosts.json`.

## Test Behavior

When run with the committed corpus, `replay_all_reference_ghosts`:

1. Loads all committed ghosts from `crates/validator/reference-ghosts.json`.
2. Loads track data for each ghost's track ID (1, 2, or 3).
3. Re-simulates each ghost through the WASM physics engine (seed 42).
4. Compares the resim finish tick to the recorded finish tick.
5. Allows a 2-tick tolerance for floating-point differences.
6. Fails CI if any ghost diverges beyond tolerance.

Currently: 216 ghosts loaded, 216 pass, 0 fail.

## CI Integration

The test runs automatically in CI via the `drawrace-build` WorkflowTemplate:

```yaml
# test-validator step — plan.md §Multiplayer & Backend 10
- name: test-validator
  template: cargo-test
  dependencies: [checkout]
  arguments:
    parameters:
      - name: crate
        value: validator
# which runs: cargo test -p drawrace-validator
```

## Track Coverage

Current track store (`apps/web/public/tracks/`):

- Track 1: `hills-01.json` (Scribble Slope)
- Track 2: `canyon-02.json`
- Track 3: `dunes-03.json`

Ghosts only reference these track IDs (1, 2, 3). Adding a track requires
re-running the generator so it picks up the new track ID.

## Determinism Guarantee

The purpose of this test is to catch **physics drift** — any change to the
physics engine that causes replayed ghosts to finish at different times. This
ensures:

1. Physics updates remain deterministic across platforms.
2. Refactors don't silently change gameplay behavior.
3. Engine-version upgrades keep the corpus honest (the recorded
   `physics_version` reflects the WASM that actually produced each time).

## Re-sourcing from Production (deferred)

The eventual plan (plan.md §Testing 6) is to source the corpus from ≥200
real-player ghosts accepted by the production backend. **Production is not
deployed** (`DRAWBUILD_CI_STATUS.md`, dated 2026-06-27; `api-drawrace.ardenone.com`
is NXDOMAIN; tracked by the open deployment beads), so there is no Postgres to
query today. The in-tree generator above is the working source in the meantime.

Once the backend is live and serving real submissions, re-sourcing follows this
path (gated entirely on deployment — not actionable until then). The canonical
implementation is the **`extract-reference-ghosts`** binary
(`crates/validator/src/bin/extract-reference-ghosts.rs`), which runs the exact
two-stage contract below.

### Stage 1 — query `ghosts` metadata rows (Postgres)

The `ghosts` table is **metadata-only**. Per `crates/api/migrations/001_initial.sql`
(+ `006_wheel_swaps.sql`, `008_daily_challenges.sql`), its columns are
`ghost_id, player_uuid, track_id, physics_version, time_ms, is_pb, is_legacy,
s3_key, created_at, wheel_count, daily_challenge_date`. **There is no `wheels`
column and no `finish_time_ms` column** — the wheel-swap geometry lives in the
binary blob in object storage, keyed by `s3_key`. (An earlier version of this
README showed a `SELECT g.id, g.finish_time_ms, g.wheels FROM ghosts` query —
none of those columns exist; that query would not compile against the real
schema.) The extractor runs this windowed metadata query:

```sql
WITH ranked AS (
    SELECT ghost_id, player_uuid, track_id, physics_version, time_ms,
           is_pb, is_legacy, s3_key, created_at,
           ROW_NUMBER() OVER (
               PARTITION BY track_id
               ORDER BY is_pb DESC, time_ms ASC
           ) AS rn
      FROM ghosts
     WHERE track_id = ANY(ARRAY[1, 2, 3])   -- 1=hills-01, 2=canyon-02, 3=dunes-03
       AND is_legacy = false
       AND physics_version = 8               -- current PHYSICS_VERSION
)
SELECT ghost_id, player_uuid, track_id, physics_version, time_ms,
       is_pb, is_legacy, s3_key, created_at
  FROM ranked
 WHERE rn <= 80                              -- 80/track -> up to 240 (>=200 bar)
 ORDER BY track_id ASC, rn ASC;
```

Every `ghosts` row is an accepted run by construction (`submissions.status`
flips to `'accepted'` when the row is inserted), so no `status` filter is
needed. The `is_pb DESC, time_ms ASC` ordering surfaces clean drivable runs
first.

### Stage 2 — fetch + decode each DRGH blob (S3/Garage)

For each metadata row, fetch the blob at `ghosts.s3_key` from
`drawrace-ghosts` (Garage on ardenone-hub) and decode it via
`drawrace_api::blob::GhostBlob` — the v2 `wheels[]` format with a
`physics_version` header. This is where the real drivable polygons come from.

### Running it

```bash
DATABASE_URL=... S3_BUCKET=drawrace-ghosts S3_ENDPOINT=... \
AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... CURRENT_PHYSICS_VERSION=8 \
  cargo run -p drawrace-validator --bin extract-reference-ghosts -- \
    --out crates/validator/raw-ghost-extract.json
```

See the binary's header doc for the full six-variable env contract and the
offline `--self-check` mode. The dump is then reformatted to the
`ReferenceGhost` schema consumed by `replay.rs`, and the test
(`cargo test -p drawrace-validator --test replay`) confirms every extracted
ghost finishes within the 2-tick tolerance.

This is deferred and explicitly not required for the gate to be meaningful
today — the physics-derived generator corpus already exercises the re-sim path
end to end.

## TODO

- [x] Populate `reference-ghosts.json` with ≥200 drivable ghosts (216; 72/track × 3)
- [x] Make every `finish_time_ms` physics-derived (not a hand-picked constant)
- [x] Verify all corpus ghosts pass re-simulation (216/216 pass)
- [ ] Add a CI status badge showing the replay-test result
- [ ] Add per-track ghost subsets for targeted testing
- [ ] Re-source the corpus from real production ghosts (gated on backend
      deployment — see [Re-sourcing from Production (deferred)](#re-sourcing-from-production-deferred))
