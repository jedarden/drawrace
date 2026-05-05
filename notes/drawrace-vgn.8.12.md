# drawrace-vgn.8.12: AWD Implementation Verification

## Task Summary
Change vehicle from 'drawn front + cartoon-circle rear' to 'drawn front + drawn rear' with independent Planck WheelJoints and motors (AWD).

## Verification Results

### Implementation Already Complete

1. **Both wheels use drawn polygon (AWD)** ✅
   - `race-sim.ts:191`: `this.rearWheelBody = buildWheelBody(...)` uses drawn polygon
   - Front wheel at lines 158-176 also uses drawn polygon

2. **Chassis density = 1.0** ✅
   - `race-sim.ts:51`: `const CHASSIS_DENSITY = 1.0;`

3. **Motor settings correct** ✅
   - `race-sim.ts:52-53`: `MOTOR_SPEED = 8`, `MOTOR_MAX_TORQUE = 40`
   - Both joints have `enableMotor: true` with these values (lines 204-205, 226-227)

4. **Twin-wheel swap** ✅
   - `swap.ts:118-182`: `executeTwinWheelSwap()` swaps both wheels in a single tick
   - `race-sim.ts:239`: calls `executeTwinWheelSwap` in `swapWheel()`

5. **Renderer shows both wheels** ✅
   - `Renderer.ts:867-868`: Both rear and front wheels rendered with `wheelPath`
   - Each wheel rotates by its own `body.angle` (line 603: `ctx.rotate(-body.angle)`)

6. **Golden tests pass** ✅
   - All 14 golden tests pass with the AWD setup
   - Golden test setup also uses `buildWheelBody` for both wheels

7. **Build succeeds** ✅

## Conclusion
All deliverables for drawrace-vgn.8.12 were already implemented in prior work.
No code changes required.
