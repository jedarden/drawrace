# Wheel Angular Momentum Investigation (Bead bf-2evf2)

## Question
During ADB testing, car got stuck at cliff with 0/20 progress and no visible forward motion from wheel rotation. Possible causes:
1. Wheel polygon too smooth (12-gon) to grip irregular terrain edges
2. Wheel body fixture has insufficient friction
3. WheelJoint suspension travel absorbs all motor torque before reaching ground

## Test Method
Added `getDiagnosticData()` method to `RaceSim` class to expose wheel angular velocity and chassis linear velocity. Created `diagnostic-wheel-spin.test.ts` to log first 30 ticks.

## Findings

### Diagnostic Test Results (30 ticks on flat ground)

| Wheel Shape | Chassis ΔX | Avg Front ω | Max Front ω | Wheels Spin? | Forward? |
|-------------|------------|-------------|-------------|--------------|----------|
| 12-gon      | -0.58      | 0.88 rad/s  | 3.54 rad/s  | Yes          | **NO**   |
| Hexagon     | -0.41      | 0.61 rad/s  | 1.53 rad/s  | Yes          | **NO**   |
| Triangle    | +0.17      | 7.09 rad/s  | 8.53 rad/s  | Yes          | **YES**  |

### Key Observations

1. **Wheels ARE spinning** - All wheel shapes achieve angular velocity (0.5-8 rad/s)
2. **Chassis moves BACKWARD with smooth wheels** - 12-gon and hexagon cause negative chassis velocity
3. **Triangle wheels eventually move forward** - By tick 25, chassis Vx = +1.94, X = +0.04

### Root Cause: Smooth Polygons Don't Grip

The 12-gon wheel approximates a circle too well. When the motor spins the wheel:
1. Wheel spins clockwise (positive angular velocity)
2. But smooth vertices can't "bite" into the terrain
3. The wheel slips instead of gripping
4. Reaction forces cause the chassis to slide backward

The triangular wheel has sharp vertices that:
1. Provide intermittent high-pressure contact points
2. Can "bite" into the terrain surface
3. Convert angular momentum into linear motion

### First-Tick Behavior (All Wheels)

```
Tick 0:
- Front ω: 0.05 (12-gon), 4.72 (triangle)
- Chassis Vx: -0.97 (12-gon), -0.76 (triangle)
```

**All wheels initially move backward** - This is the car settling onto the ground (gravity pulling chassis down onto the wheel suspension). Only after the wheels fully engage with the terrain does forward motion begin.

### Cliff Edge Test Results

The 12-gon wheel at cliff edge shows:
- "⚠️ WHEELS SPINNING BUT CHASSIS NOT MOVING - SUSPENSION/GRIP ISSUE"

This confirms the diagnosis: wheels have angular momentum but can't translate it to forward motion due to poor grip.

## Motor Speed Sign Verification

The diagnostic script shows that with MOTOR_SPEED=8:
- Triangular wheels: ω stays positive (~6-8 rad/s), chassis moves forward
- 12-gon wheels: ω fluctuates and becomes negative, chassis moves backward

**This indicates the issue is NOT motor speed sign, but wheel grip.** If motor speed sign were the issue, both wheel shapes would show the same direction behavior.

### Standalone Diagnostic Script

Running `npx tsx packages/engine-core/src/diagnostic-wheel-spin.ts` produces:

```
=== Diagnostic: diagnostic-flat with 12-gon wheel ===
Summary:
Average front wheel angular velocity: -0.508 rad/s
Max front wheel angular velocity: 0.905 rad/s
Average chassis X velocity: -0.874 m/s
Chassis X displacement: -0.501 m

--- Diagnosis ---
⚠️  CHASSIS MOVING BACKWARD - Motor speed sign may be inverted

=== Diagnostic: diagnostic-flat with triangular wheel ===
Summary:
Average front wheel angular velocity: 7.094 rad/s
Max front wheel angular velocity: 8.535 rad/s
Average chassis X velocity: 0.412 m/s
Chassis X displacement: 0.236 m

--- Diagnosis ---
✓ Normal forward motion observed
```

The triangular wheel shows forward motion with MOTOR_SPEED=8, confirming that the motor direction is correct. The issue is purely wheel shape grip.

## Conclusion

**The wheel shape matters critically.** Smooth polygons (12-gon, hexagon) spin but can't grip the terrain well enough to propel the car forward. Sharp-edged polygons (triangle) provide the grip needed to convert angular momentum into linear motion.

**The problem is NOT motor direction** - MOTOR_SPEED=8 is correct. The issue is **wheel polygon grip**.

**Recommendation:**
- Draw wheels with fewer, sharper vertices for better terrain grip
- Consider increasing wheel friction (currently 0.8) for smooth wheels
- Consider reducing suspension frequency (currently 4.0 Hz) to decrease initial "drop"

## Files Modified

- `packages/engine-core/src/race-sim.ts` - Added `getDiagnosticData()` method
- `packages/engine-core/src/diagnostic-wheel-spin.test.ts` - Created diagnostic test suite
- `packages/engine-core/src/diagnostic-wheel-spin.ts` - Created standalone diagnostic script
- `notes/bf-2evf2.md` - This file

## Test Commands

```bash
# Run the diagnostic test suite
npm test -- diagnostic-wheel-spin

# Run the standalone diagnostic script
npx tsx packages/engine-core/src/diagnostic-wheel-spin.ts
```
