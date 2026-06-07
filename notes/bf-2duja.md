# MOTOR_SPEED Sign Investigation (Bead bf-2duja)

## Question
Does `MOTOR_SPEED=8` (positive) drive wheels backward instead of forward?

## Findings
**No.** `MOTOR_SPEED=+8` drives the car **forward (+x)**.

## Investigation Details

### Coordinate System
The codebase uses a **Y-down coordinate system**:
- Gravity = `[0, 10]` (positive Y = down)
- This is the default for Planck.js

The task description incorrectly assumed a Y-up system.

### Motor Direction Test Results
```
motorSpeed=+8 → final X = +4.85 (forward)
motorSpeed=-8 → final X = -3.85 (backward)
motorSpeed=0  → final X = -0.03 (essentially stationary)
```

### Why +8 Drives Forward in Y-down
In Y-down coordinate system:
- **Positive angular velocity = CLOCKWISE rotation** (viewed from above)
- A wheel rotating clockwise on a surface pushes the car **right (+x)**
- This is the forward direction

### Suspension Axis Verification
`localAxisA: Vec2(0, 1)` is correct:
- In Y-down, Vec2(0, 1) points DOWN
- This is the correct vertical axis for wheel suspension
- The suspension allows the wheel to move up/down relative to the chassis

### Files Verified
- `packages/engine-core/src/headless-race.ts` - MOTOR_SPEED = 8
- `packages/engine-core/src/headless.ts` - MOTOR_SPEED = 8
- `packages/engine-core/src/swap.ts` - MOTOR_SPEED = 8

All three files use positive MOTOR_SPEED consistently, which drives forward.

## Conclusion
**No change needed.** The current `MOTOR_SPEED=8` (positive) correctly drives the car forward in the Y-down coordinate system used by Planck.js.
