# Wheel Hot-Swap Contradiction Analysis

## Overview

This document captures the contradiction that existed between the AWD (All-Wheel Drive) twin-wheel swap specification and an inconsistent bullet point in the DrawRace implementation plan.

**Status**: ✅ **RESOLVED** - This contradiction was identified and corrected during the plan.md alignment verification (bead nd-1tdq, completed 2026-07-04).

---

## The Contradiction

### AWD Twin-Wheel Swap Specification

**Location**: `docs/research/AWD_TWIN_WHEEL_SWAP_SPECIFICATION.md` (extracted from plan.md Section 3)

**What the AWD spec says about wheel swapping:**

> "When a mid-race stroke commits, the simulation performs a **deterministic twin body-swap** at the next tick boundary: both the front and rear wheels are destroyed and rebuilt with the new polygon at the same tick."

**Key implementation details:**

```pseudocode
on commitSwap(newPolygon, swap_tick):
    assert simTick == swap_tick
    for axle in [chassis.frontAxle, chassis.rearAxle]:  // both wheels swap together
        old = axle.wheel
        newBody = buildWheelBody(newPolygon)
        // ... rebuild both wheels
```

**Core principle**: The drawn polygon is applied to **both wheels simultaneously**. The vehicle is AWD — both front and rear axles use the same drawn polygon and both swap together during mid-race redraws.

---

### Contradictory Bullet Point

**What the contradictory bullet said about the rear axle:**

> "Rear axle untouched. Only the drawn front wheel swaps. The rear cartoon-circle wheel (plan §Graphics 5) is permanent."

This bullet claimed that:
1. Only the front wheel performed the hot-swap during mid-race redraws
2. The rear wheel remained a permanent cartoon circle (unchanging shape)
3. The rear axle was not involved in the swap mechanism

---

## Specific Contradiction Points

### 1. Swap Scope Contradiction

**AWD Spec**: Both front and rear wheels swap together
```
for axle in [chassis.frontAxle, chassis.rearAxle]:  // both wheels swap together
```

**Contradictory Bullet**: Only the front wheel swaps
> "Only the drawn front wheel swaps"

**Conflict**: The bullet explicitly states the rear wheel doesn't swap, directly contradicting the AWD specification's requirement that both wheels swap simultaneously.

### 2. Wheel Type Contradiction

**AWD Spec**: Both wheels use the drawn polygon
> "Both wheel wells hold a copy of the same polygon... The car is effectively AWD"

**Contradictory Bullet**: Rear wheel is a permanent cartoon circle
> "The rear cartoon-circle wheel (plan §Graphics 5) is permanent"

**Conflict**: The bullet describes a single-wheel-draw architecture where only the front wheel is player-drawn, while the AWD spec explicitly requires both wheels to use the same drawn polygon.

### 3. Behavioral Contradiction

**AWD Spec**: Full player agency over both wheels
> "With both wheels drawn, the full behaviour of the car is downstream of what the player draws"

**Contradictory Bullet**: Rear axle behavior is fixed/unchanging
> "Rear axle untouched"

**Conflict**: The bullet suggests 50% of vehicle behavior (the rear axle contribution) is static, while the AWD spec is built on the premise that player drawing controls 100% of vehicle behavior through both axles.

---

## Resolution

**Fixed in**: plan.md alignment verification (bead nd-1tdq, 2026-07-04)

**Resolution**: The contradictory bullet was removed from plan.md. The document now consistently reflects the AWD twin-wheel swap specification throughout:

- Line 273: "**Both wheels use the drawn polygon (AWD).**"
- Line 275: "Both wheel wells hold a copy of the same polygon... The car is effectively AWD"
- Line 283: "**Wheel hot-swap procedure (mid-race redraw, twin-wheel)**"
- Lines 287-307: Pseudocode correctly shows `for axle in [chassis.frontAxle, chassis.rearAxle]: // both wheels swap together`

**Verification**: grep search for "Rear axle untouched" now returns no results in plan.md, confirming the contradictory text has been removed.

---

## Impact Assessment

### If Contradiction Had Remained

1. **Implementation confusion**: Developers might have implemented single-wheel hot-swap instead of twin-wheel
2. **Gameplay mechanics wrong**: Core skill tension (shape adaptation under time pressure) would be undermined if only 50% of vehicle behavior responded to redraws
3. **Physics asymmetry**: Vehicle handling would behave unexpectedly, with front wheel responding to player input while rear wheel remained static
4. **Validation failure**: Server-side replay verification would fail if client implemented single-wheel but spec claimed twin-wheel

### Current Correct State

The entire DrawRace codebase now correctly implements AWD twin-wheel hot-swap:
- Both wheels swap simultaneously during mid-race redraws
- Player has full agency over vehicle behavior through both axles
- Physics model treats front and rear wheels symmetrically
- Ghost replay system stores one polygon per swap and applies it to both wheels

---

## Related Documentation

- `docs/research/AWD_TWIN_WHEEL_SWAP_SPECIFICATION.md` - Complete AWD specification
- `docs/plan/plan.md` Section 3 - Shape-to-Physics Translation (lines 273-310)
- `docs/notes/nd-1tdq.md` - Plan.md alignment verification that identified this contradiction
- `PROGRESS.md` - Mid-Race Wheel Redraw Pass (drawrace-vgn.8) — CLOSED

---

## Conclusion

This contradiction represented a fundamental conflict between the documented architecture (AWD twin-wheel hot-swap) and an outdated bullet point describing single-wheel behavior. The contradiction has been resolved, and the documentation now consistently reflects the correct AWD implementation where both wheels swap together during mid-race redraws.

The resolution ensures that:
- All documentation speaks with one voice about wheel swapping behavior
- Implementation guidance is unambiguous
- The core gameplay mechanic (shape adaptation affecting both axles) is properly documented
- Future development work proceeds from a consistent architectural foundation