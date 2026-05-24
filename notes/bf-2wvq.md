# Daily Challenge Implementation Verification (Bead bf-2wvq)

## Task Requirements
- Same track with modifier (gravity/friction)
- Seeded from UTC date
- Separate leaderboard

## Verification Status: COMPLETE ✅

All requirements have been implemented in commit `fd9f91e`.

## Implementation Summary

### Backend (`crates/api/`)
- **Database Schema** (`008_daily_challenges.sql`, `009_submissions_daily_challenge.sql`):
  - `daily_challenges` table with challenge_date, track_id, and modifiers
  - `daily_challenge_date` column added to ghosts and submissions tables

- **Seeded PRNG** (`handlers/daily_challenge.rs`):
  - `SeededRng::from_date()` uses UTC date string (YYYY-MM-DD) as seed
  - Deterministic LCG for reproducible modifier generation
  - Track selection: `(1 + (rng.next() % 3))` picks track 1-3

- **Modifiers Generated**:
  - `gravity_multiplier`: 0.7 to 1.5
  - `friction_multiplier`: 0.5 to 1.5
  - `chassis_mass_multiplier`: 0.8 to 1.5

- **API Endpoints**:
  - `GET /v1/daily-challenge?date=` - Get challenge config
  - `GET /v1/leaderboard/daily/{date}/top` - Daily leaderboard top N
  - `GET /v1/leaderboard/daily/{date}/context` - Context around player
  - `POST /v1/submissions` supports `daily_challenge_date` query param

### Frontend (`apps/web/`)
- **DailyChallengeScreen.tsx**: Full UI with countdown to midnight UTC, modifier display, ghost count
- **App.tsx**: Integrated flow (daily_draw → daily_race → daily_result)
- **DrawScreen.tsx**: Shows modifiers during drawing phase
- **ResultScreen.tsx**: Submits with daily_challenge_date when applicable

### Engine (`packages/engine-core/`)
- **race-sim.ts**: `ChallengeModifiers` type applies multipliers in constructor
  - Gravity scales world gravity
  - Friction scales wheel friction
  - Chassis mass scales chassis density

## Key Features
1. **Deterministic**: Same date produces same challenge for all players
2. **Separate Leaderboards**: Daily ghosts stored with `daily_challenge_date` reference
3. **Countdown Timer**: Shows time until next UTC midnight challenge
4. **Ghost Support**: Fetches top 3 ghosts for the daily challenge

## Files Changed (13 files, +1132/-45 lines)
See commit `fd9f91e` for full implementation details.
