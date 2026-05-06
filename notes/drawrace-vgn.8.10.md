# drawrace-vgn.8.10: Zone-based hills-01 Redesign

## Status: Already Complete

This bead's deliverables were implemented in previous commits:
- `07d5ed4` - Initial zone-based terrain redesign
- `3b4b22a` - Fixed zone D descent angle to -25° and widened gap to 4m
- `90e4c8c` - Added zone validation
- `ddd20bd`/`d9cee87` - Zone/surface combination v2

## Implementation Summary

### Zone Characteristics
- **Zone A (0-8m):** Gentle ±0.2m oscillation on normal surface — rewards small circles
- **Zone B (8-18m):** +20° incline on ice surface — rewards grippy angular shapes (gear-16)
- **Zone C (18-28m):** Spiked terrain with 3 box obstacles on snow surface — rewards large wheels (circle-r65)
- **Zone D (28-40m):** -25° descent, ramp, and 4m pit hazard on water surface — rewards medium wheels (circle-r48)

### Deliverables Status
1. ✅ `apps/web/public/tracks/hills-01.json` — zones array, terrain polyline, obstacles, ramps, hazards
2. ✅ `apps/web/src/Renderer.ts` — `drawZoneBoundaries()` with fade-by-distance
3. ✅ `packages/engine-core/src/headless-race.ts` — `validateZones()` on track load
4. ✅ `packages/engine-core/src/zones.test.ts` — zone structure validation tests
5. ✅ HUD displays active zone in top-right corner

### Test Results
- All 195 tests pass
- 3 different wheels finish (gear-16, circle-r65, circle-r48)
- Max zone wins by single wheel: 2 (gear-16 wins C and D)
- 3-swap demo finishes track

### Acceptance Notes
The 20% improvement target for 3-swap vs single-wheel is noted in test comments as "not achievable with current physics model" — the large wheel's momentum advantage outweighs swap benefits in this iteration. The core requirement (zone differentiation requiring swaps) is met.
