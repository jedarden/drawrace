# drawrace-vgn.9: Racers render below terrain line - Fix Summary

## Task
Fix visual bug where player car and ghost cars appeared beneath the terrain polyline instead of sitting on top of it.

## Root Cause
The physics simulation reports the wheel center position at the terrain surface when the car is resting. The renderer was drawing the wheel at this center position, which caused the wheel (and attached chassis) to appear partially submerged in the terrain fill.

## Solution
Offset the rendering position upward by `REAR_WHEEL_RADIUS` (0.35 meters = 10.5 pixels) so that:
- Wheel bottom touches the terrain line
- Chassis sits above the terrain
- Ghost name tags are positioned correctly

## Changes Made
**Commit 7d50c54:**
- `drawWheel()`: offset y-coordinate by `-REAR_WHEEL_RADIUS`
- `drawChassis()`: offset y-coordinate by `-REAR_WHEEL_RADIUS`
- Ghost name tag: offset y-coordinate by `-REAR_WHEEL_RADIUS`

**Layer 3 Snapshots Updated:**
- `tick-0.png`, `tick-30.png`, `tick-120.png`, `tick-300.png`, `tick-finish.png`
- `ghost-swap-start.png`, `ghost-swap-swap-start.png`, `ghost-swap-mid-swap.png`

## Verification
- Visual inspection confirms racers now sit ON TOP of terrain fill
- Wheel bottom is visibly in contact with ink top edge of terrain
- Layer 3 snapshot baselines updated to reflect corrected rendering
- Draw order matches plan §Graphics 3: sky → hills → terrain → ghosts → player → FX → HUD

## Coordinate System Notes
- Physics: Y-down (gravity +10 pulls down)
- Canvas: Y-down (screen Y increases downward)
- When wheel rests on terrain: `wheel.y + radius = terrainY`
- Rendering offset: `wheel.y - REAR_WHEEL_RADIUS` puts wheel center above terrain line
