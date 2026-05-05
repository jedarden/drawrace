# Mid-race wheel redraw implementation (drawrace-vgn.8)

## Completed 2026-05-05

All acceptance criteria met:
1. Client: always-on draw overlay, pointer capture isolated, 500ms cooldown gauge, 20-swap cap, hot-swap preserves position/velocity
2. Determinism: tick-indexed swaps, Layer 2 goldens with all 6 swap scenarios, bit-exact re-sim
3. Ghost format: wheels[] binary layout, client/validator agreement, legacy ghost handling
4. Ghost playback: visible swaps at recorded ticks with crossfade
5. UX: Race HUD swap counter, pause only from top-left, tutorial ghosts with ≥1 swap
6. Phone-smoke: Pixel 6 demonstrates draw → race → mid-race redraw → finish
7. Re-sim tolerance: ≤2 ticks across all multi-wheel scenarios

## Retrospective

**What worked:**
- Built on existing physics engine (swap.ts) and followed plan spec closely
- Used twin-wheel swap (executeTwinWheelSwap) to preserve position continuity
- Reused DrawScreen's draw-pipeline for overlay consistency
- Ghost format extended with wheels[] binary layout while maintaining backwards compatibility

**What didn't:**
- Initial approach tried single-wheel swap first, but plan required twin-wheel for position continuity. Had to refactor to use executeTwinWheelSwap instead.

**Surprise:**
- Ghost playback required crossfade animation to make swaps visible—initially just swapped geometry instantly, but players couldn't see when ghosts swapped. Added 200ms easeOutCubic crossfade.

**Reusable pattern:**
- For hot-swap mechanics that preserve state: capture old body position/velocity before destruction, spawn new body at same position, carry over linear velocity but reset angular (moment of inertia changes). This pattern applies to any mid-simulation geometry swap.

## Commit
7feea9f feat: complete mid-race wheel redraw implementation (v1 core mechanic)
