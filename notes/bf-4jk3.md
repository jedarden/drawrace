# bf-4jk3: Cosmetic Wheel Trails - Task Verification

## Task
Post-v1: Cosmetic wheel trails — unlockable by total distance raced (plan §Post-v1 Backlog 8)

## Status: ✅ COMPLETE

The cosmetic wheel trails feature was fully implemented in commit `51d7191` on 2026-06-10.

## Implementation Summary

### Files Created/Modified
1. **`apps/web/src/progression.ts`** (232 lines) - Player progression system
   - localStorage-based distance tracking
   - Trail unlock thresholds (500m to 25km)
   - Helper functions for progression queries

2. **`apps/web/src/Trails.ts`** (182 lines) - Particle system for wheel trails
   - 6 trail types: none, dust, ember, magic, rainbow, void
   - Rainbow trail with rotating hue
   - Reduced motion support
   - Particle pool limits (128 max, emit every 3 frames)

3. **`apps/web/src/Renderer.ts`** (+49 lines) - Trail rendering integration
   - Render trails in layer 4.5 (behind wheels, above ghosts)
   - Emit particles from both wheel positions

4. **`apps/web/src/RaceScreen.tsx`** (+13 lines) - Distance tracking
   - Initialize TrailSystem with player's selected trail
   - Call `addDistance(track.finish.pos[0])` on race completion

5. **`apps/web/src/SettingsScreen.tsx`** (+124 lines) - Trail selection UI
   - Display total distance and next unlock progress
   - Trail selection buttons with lock/unlock states
   - Visual feedback for selected trail

### Trail Unlock Progression
1. **Dust Cloud** (500m) - Gentle earth-tone dust
2. **Ember Sparks** (2km) - Orange racer-red sparks
3. **Magic Dust** (5km) - Sparkly blue particles
4. **Rainbow Trail** (10km) - Vibrant cycling rainbow
5. **Void Walker** (25km) - Dark energy particles

## Verification
- All code has been committed
- No TODOs or FIXMEs in relevant files
- Implementation follows the plan specification
- Feature integrates with existing game systems
