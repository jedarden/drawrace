# MOTOR_SPEED Sign Verification (Bead bf-5hedz)

## Task
Fix MOTOR_SPEED sign and add headless forward-motion regression test.

## Findings
**No code changes needed.** Investigation bead `bf-2duja` confirmed:
- Code uses Y-down coordinate system (gravity = [0, 10])
- MOTOR_SPEED=+8 (positive) drives the car forward (+x)
- The regression test was already implemented in `headless.test.ts` (lines 263-277)

## Verification
Ran `npx vitest run` — all 97 unit tests pass:
- ✓ forward motion: chassis_vx at tick 60 is positive with circle wheel (regression test) 24ms

## Files Verified (all using correct MOTOR_SPEED=+8)
- `packages/engine-core/src/headless.ts`
- `packages/engine-core/src/headless-race.ts`
- `packages/engine-core/src/swap.ts`

## Regression Test
Test in `headless.test.ts` asserts:
- Circle wheel on hills-01 track
- At tick 60, chassis_vx > 0.1 (forward motion)
- Test passes, confirming +8 drives forward

## Conclusion
The task is complete — the investigation bead findings were correct, and the regression test locks in the verified behavior.
