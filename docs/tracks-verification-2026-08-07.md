# Track Files Verification — 2026-08-07

## Purpose

Verification of track file existence, wiring in App.tsx, and plan.md documentation status as requested by bead nd-29ik.

## Track Files — ✅ All Present and Correct

All three v1 track files exist at the expected locations:

1. **`apps/web/public/tracks/hills-01.json`**
   - numeric_id: 1
   - name: "Scribble Slope"
   - version: 33
   - 4 zones (A-D) with mixed surfaces (normal, snow, water)
   - 3 box obstacles in zone C
   - Pit hazard at x=38-40

2. **`apps/web/public/tracks/canyon-02.json`**
   - numeric_id: 2
   - name: "Canyon Run"
   - version: 1
   - 5 zones (A-E)
   - Mixed surfaces: normal → mud → rock → ice → normal
   - 3 box obstacles in zones D-E
   - Pit hazard at x=12-16

3. **`apps/web/public/tracks/dunes-03.json`**
   - numeric_id: 3
   - name: "Dune Drifter"
   - version: 1
   - 5 zones (A-E)
   - Mixed surfaces: normal → water → normal → rock → ice → snow
   - 3 box obstacles in zone D
   - Pit hazard at x=19-22

## Track Wiring in App.tsx — ✅ Properly Integrated

### Track Registration (lines 25-29)
```typescript
const TRACKS = [
  { id: "hills-01", numeric_id: 1, name: "Scribble Slope" },
  { id: "canyon-02", numeric_id: 2, name: "Canyon Run" },
  { id: "dunes-03", numeric_id: 3, name: "Dune Drifter" },
];
```

### Dynamic Loading (lines 156-164)
- useEffect hook loads track data from `/tracks/{currentTrack.id}.json`
- Validates zones and surfaces on load
- Fetches ghosts for the track
- Current track index persisted to localStorage

### Track Switching (lines 276-281)
- `handleRotateTrack` cycles through tracks modulo TRACKS.length
- Persists selection to localStorage
- Fully functional track switcher on Draw screen

## plan.md Documentation Status — ✅ Already Up to Date

### §Gameplay & Physics 7 (lines 491-496)

**Status: Already Current**

The section already correctly states:
```
**Three tracks shipped in v1 (2026-04)** — All three tracks are live and wired into the app:
- `apps/web/public/tracks/hills-01.json` (numeric_id: 1, "Scribble Slope")
- `apps/web/public/tracks/canyon-02.json` (numeric_id: 2, "Canyon Run")
- `apps/web/public/tracks/dunes-03.json` (numeric_id: 3, "Dune Drifter")

Tracks are registered in `apps/web/src/App.tsx` and selectable via the track switcher on the Draw screen.
```

### §Roadmap 'v1 Cut Line' (lines 2940-2944)

**Status: Already Current**

The "Multiple tracks" item is correctly marked as shipped:
```
- ~~Multiple tracks~~ **SHIPPED 2026-04**: Three tracks live in production:
  - `apps/web/public/tracks/hills-01.json` (numeric_id: 1, "Scribble Slope")
  - `apps/web/public/tracks/canyon-02.json` (numeric_id: 2, "Canyon Run")
  - `apps/web/public/tracks/dunes-03.json` (numeric_id: 3, "Dune Drifter")
  All three tracks are wired into `apps/web/src/App.tsx` and playable via the track switcher.
```

## Test Results

- **All 337 tests passing** (35 test files)
  - Physics golden tests (Layer 2): 16/16 passing
  - E2E tests: All passing
  - Unit tests: All passing
- **Lint passes** with no errors
- **Track loading validated**: All three tracks load without errors

## Conclusion

**No updates needed to plan.md** — both §Gameplay & Physics 7 and §Roadmap 'v1 Cut Line' already accurately reflect the shipped state of all three tracks. The documentation is current and matches the actual implementation.

The track system is fully functional with proper file structure, dynamic loading, validation, and user switching between tracks.

## Next Steps

As per bead nd-29ik acceptance criteria:
- ✅ Read docs/plan/plan.md and identified sections (both already up to date)
- ✅ Verified all 3 track files exist with correct structure
- ✅ Verified tracks are referenced in apps/web/src/App.tsx
- ✅ Documented current state for next steps

The bead can be closed as all acceptance criteria are met.
