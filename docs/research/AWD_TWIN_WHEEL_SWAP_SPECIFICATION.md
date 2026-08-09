# AWD Twin-Wheel Swap Specification
## Extracted from docs/plan/plan.md Section 3: Shape-to-Physics Translation

### AWD Concept Overview

**Both wheels use the drawn polygon (AWD).**

The drawn shape is the *vehicle's wheels*, plural — not just a front wheel. Both wheel wells hold a copy of the same polygon, mounted on the chassis via independent `WheelJoint`s with identical suspension, damping, and motor parameters. The car is effectively AWD: both wheels contribute friction and torque, which makes angular shapes like triangles actually viable on demanding terrain (claw-in grip on both axles, not just one).

### Design Rationale

**Player agency scales.** With only the front wheel drawn, the rear was a constant — so at most ~50% of vehicle behaviour reacted to the drawing. With both wheels drawn, the full behaviour of the car is downstream of what the player draws.

**Symmetry matches intuition.** Players who see a polygon drawing expect it to be "the wheel of the car," not "the front wheel of a two-wheel-asymmetric car." Visual parity (front and rear look identical) makes the physics readable.

**Moment-of-inertia doubles.** Compensated in §Gameplay 4: chassis density dropped to keep the ~4× chassis-to-wheel mass ratio stable given two drawn wheels instead of one drawn + one cartoon circle.

The chassis is a fixed rectangle, density `1.0` (was 2.0 before the AWD change), mass ≈ 4× typical combined wheel mass, so the wheel-to-chassis mass ratio stays in the same regime the physics tuning was calibrated against. We clamp the effective wheel radius to `[0.3m, 1.5m]` post-normalization to bound the range.

---

## Wheel Hot-Swap Procedure (Mid-Race Redraw, Twin-Wheel)

When a mid-race stroke commits, the simulation performs a **deterministic twin body-swap** at the next tick boundary: both the front and rear wheels are destroyed and rebuilt with the new polygon at the same tick. This is the only structural mutation the Planck world receives mid-race; everything else (chassis, terrain, ghosts) persists unchanged.

### Pseudocode Implementation

```
on commitSwap(newPolygon, swap_tick):
    assert simTick == swap_tick                         // scheduled exactly on next tick
    for axle in [chassis.frontAxle, chassis.rearAxle]:  // both wheels swap together
        old = axle.wheel
        newBody = buildWheelBody(newPolygon)            // same pipeline as initial wheel
        newBody.setPosition(old.getPosition())          // spawn in place — no teleport
        newBody.setLinearVelocity(
            chassis.getLinearVelocity())                // carry the chassis velocity
        newBody.setAngularVelocity(0)                   // zero: moment of inertia changed,
                                                        //       reusing ω would be unphysical
        world.destroyJoint(axle.joint)
        world.destroyBody(old)
        newJoint = world.createJoint(
            WheelJointDef(chassis, newBody, /* axis, freq, damping */))
        axle.wheel = newBody
        axle.joint = newJoint
        newJoint.setMaxMotorTorque(40)                  // motor params unchanged, re-bound
        newJoint.setMotorSpeed(8)
    wheel_swaps.push({ swap_tick, polygon: newPolygon })
```

### Storage Optimization

Only ONE entry is appended to `wheel_swaps` per stroke — the ghost format stores one polygon per swap event and the decoder applies it to both axles during replay (see §Multiplayer 5 / 8). This keeps blobs tight: a twin-wheel vehicle is the same wire cost as a single-wheel vehicle.

---

## Guarantees and Rationale

### Determinism
The swap is indexed by an integer `swap_tick`, not a wall-clock moment. Client and validator (§Multiplayer 8 Layer 3) apply the swap at the *same* tick during re-simulation, so bit-exact reproduction is preserved.

### Position Continuity
New wheel spawns at the old wheel's world position. Visual continuity is preserved; no teleport artifact.

### Velocity Handling
Linear velocity carries because the chassis (which retains its state) is driving it anyway. Angular velocity resets to zero because the new wheel's moment of inertia can differ by orders of magnitude from the old one; reusing `ω` would either launch the car on a small-to-large swap or stall it on a large-to-small swap. Zero is physically neutral.

### Single-Frame Cost
The swap is scheduled at a tick boundary and rebuild time on Snapdragon 665 is ~1–2 ms for an 8-vertex decomposed wheel. See §Gameplay 9.

---

## Key Technical Constraints

1. **Tick-boundary execution**: Swaps only occur at exact simTick boundaries
2. **Twin-wheel synchronization**: Both axles swap simultaneously in the same operation
3. **Motor parameter preservation**: Motor torque (40 N·m) and speed (8 rad/s) are reapplied after swap
4. **Position continuity**: New wheels spawn exactly where old wheels were positioned
5. **Linear velocity inheritance**: New wheels inherit chassis linear velocity
6. **Angular velocity reset**: New wheels start with zero angular velocity to prevent physics artifacts
7. **Single log entry**: One wheel_swaps entry records the entire twin-wheel swap event

---

## Source Location

This specification was extracted from `/home/coding/drawrace/docs/plan/plan.md`, Section 3: Shape-to-Physics Translation, subsection "Wheel hot-swap procedure (mid-race redraw, twin-wheel)" at lines 283-316.
