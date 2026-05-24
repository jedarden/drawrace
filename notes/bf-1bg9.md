# Bead bf-1bg9: Deterministic Test Hook Verification

## Summary
Verified that the production-safe `?seed=1&track=v1` deterministic test hook was already implemented in commit `6fef438` (2026-05-23).

## Implementation Verified

### 1. URL Parameter Parsing (apps/web/src/test-hooks.ts)
- `getTestSeed()`: Reads `?seed=N` from URL search params
- `getTestTrackVariant()`: Reads `?track=XXX` from URL search params
- `getDeterministicNow()`: Returns deterministic timestamp when seed is set
- `getDeterministicPerformanceNow()`: Returns deterministic high-res time when seed is set

### 2. Ghost Simulation Seed (apps/web/src/api.ts)
- `getGhostSeed()`: Returns `getTestSeed() ?? DEFAULT_MATCHMAKE_SEED`
- Ghosts fetched via `fetchGhosts()` and `fetchDailyGhosts()` use the seeded value

### 3. Player Simulation Seed (apps/web/src/RaceScreen.tsx)
- Line 147: `const playerSeed = getTestSeed()`
- Line 148: `new RaceSim(track, playerVerts, playerSeed)`

### 4. Deterministic Clock (apps/web/src/DrawScreen.tsx)
- Line 120: `startTimeRef.current = getDeterministicNow()`
- Line 160: Stroke timestamps use `getDeterministicNow() - startTimeRef.current`

### 5. E2E Test Integration (e2e/game.spec.ts)
- `getDeterministicTestUrl()` returns `"/?seed=1&track=v1"`
- All tests use this seeded URL for consistent runs

## Production Safety
The hook is production-safe because:
- No seed = normal random behavior (getTestSeed returns undefined)
- No sensitive data exposed
- No breaking changes to normal user flows
- Reserved `?track=v1` for future track variant A/B testing
