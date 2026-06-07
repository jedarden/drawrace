# Bug Fix: Countdown Cliff Sliding (bf-31s6q)

## Summary
Fixed countdown bug where car slides to cliff on sloped terrain by applying small holding torque (5 Nm) during countdown to prevent gravity-induced sliding while still stepping physics for natural settling.

## Changes
- Added `MOTOR_HOLD_TORQUE = 5` constant in `race-sim.ts`
- Updated `step()` to apply holding torque when motor not enabled (during countdown)
- Updated `RaceScreen.tsx` comment to reflect new behavior
- Motor switches to full torque (40 Nm) at GO

## Retrospective

### What worked
Approach (a) - using a low holding torque during countdown. It's simple, preserves physics settling, and doesn't require track geometry changes.

### What didn't
N/A - first approach worked correctly.

### Surprise
The fix was partially visible in the codebase (physics stepping during countdown was already there from a previous fix), only the motor torque logic needed updating from 0 to holding torque.

### Reusable pattern
For physics-based countdowns in game engines: always consider whether gravity/forces should be resisted. A small holding force (10-15% of max) can maintain position without unnatural locking.
