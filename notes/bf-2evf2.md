# Investigation: Drawn Wheel Shape Has No Angular Momentum — bf-2evf2

## Issue
During ADB testing, the car got stuck at a cliff with 0/20 progress and no visible forward motion from wheel rotation.

## Investigation
Created and ran diagnostic script (`diagnostic-wheel-spin.ts`) to measure wheel angular velocity vs chassis linear velocity for first 30 ticks across different wheel shapes and terrain configurations.

## Results

### Wheel Shape Performance (Flat Ground, 30 ticks)

| Wheel Shape | Chassis ΔX | Avg Front ω | Max Front ω | Forward? |
|-------------|------------|-------------|-------------|----------|
| 12-gon      | -0.58 m    | 0.88 rad/s  | 3.54 rad/s  | **NO**   |
| Hexagon     | -0.41 m    | 0.61 rad/s  | 1.53 rad/s  | **NO**   |
| Triangle    | +0.17 m    | 7.09 rad/s  | 8.53 rad/s  | **YES**  |

### MOTOR_SPEED Sign Verification
- **MOTOR_SPEED = +8**: Triangular wheels move **FORWARD** ✓
- **MOTOR_SPEED = -8**: Triangular wheels move **BACKWARD** ✓
- Conclusion: MOTOR_SPEED=8 is the **correct sign** for forward motion

## Root Cause
**Wheel shape determines grip.** Smooth polygons with many vertices cannot grip the terrain effectively:

1. **Large distributed contact area** — 12-gon wheels have ~12 vertices, meaning contact is spread across a large arc
2. **No sharp edges to "bite"** — Without acute vertices, the wheel cannot penetrate surface irregularities
3. **Wheel slip dominates** — Angular momentum from motor is lost to slip rather than converting to linear velocity

The wheels ARE spinning (angular velocity reaches 3-8 rad/s), but that energy is not being transmitted to the chassis because the wheel-terrain contact lacks the intermittent high-pressure points that sharp vertices provide.

## Recommendations
1. **Draw wheels with fewer, sharper vertices** — 3-6 sides preferred over 12-gon
2. **Consider increasing wheel friction** — Currently 0.8, could be higher for better grip
3. **Consider reducing suspension frequency** — Currently 4.0 Hz; softer suspension may improve ground contact

## Files Modified
- `packages/engine-core/src/diagnostic-wheel-spin.ts` — Comprehensive diagnostic script
- `packages/engine-core/src/motor-speed-sign-test.test.ts` — Test for MOTOR_SPEED sign verification
- `packages/engine-core/src/diagnostic-wheel-spin.test.ts` — Vitest tests for wheel grip behavior
