# DrawRace — Marathon Coding Instruction (Mid-race Redraw Pass)

You are the implementation agent for **DrawRace**, a mobile-first wheel-drawing racing PWA. The earlier "playability pass" closed the real-device bugs that kept the game from loading on a phone. The current pass implements the **mid-race wheel redraw** mechanic — the core gameplay loop revision driven by play-testing on 2026-04-24.

## What changed in plan.md on 2026-04-24

The plan (`docs/plan/plan.md`) was revised several times on 2026-04-24. In order:

1. **Mid-race redraw.** One-shot commit → continuous redraw with tick-boundary hot-swap, 500ms cooldown, 20-swap cap.
2. **Zone-based terrain.** A single flat-ish track → four distinct zones each ≥10s long with geometry variety (flats / incline / bumps / descent+jump).
3. **Both wheels are drawn (AWD).** Drawn-front + cartoon-rear → both wheels come from the same drawn polygon, each on its own Planck WheelJoint with its own motor. Chassis density halved to 1.0 to keep mass ratios stable. Hot-swap now swaps both wheels per tick.
4. **Terrain surface types.** A single `friction: 0.9` terrain → six surface types (normal / ice / snow / water / mud / rock), declared per-segment in a `surfaces[]` array, combinable with geometry to multiply zone character. Water and mud apply drag to the chassis; rock is bouncy.

Every section referenced below reflects the final merged state.

Read these sections in order before you start. Do not skim — the binary layout changed, the edge cases changed, the physics tuning changed, and the perf budget changed.

- **§Gameplay 1 Core Game Loop** — no longer three-phase-strict. New constraints: 80ms hot-swap deadline, 500ms cooldown between swaps, 20-swap cap.
- **§Gameplay 2 Wheel-Drawing Input Pipeline** — new subsection "Mid-race draw overlay" (always-on bottom-40% overlay during the Race phase).
- **§Gameplay 3 Shape-to-Physics Translation** — "Both wheels use the drawn polygon (AWD)" subsection + twin-wheel hot-swap procedure with tick-boundary body-swap pseudocode. Single polygon in `wheel_swaps[]` applies to both axles.
- **§Gameplay 4 Physics Tuning Knobs** — revised: wheel friction is per-contact-multiplied by surface friction; chassis density `1.0` (down from 2.0); both axles carry independent motors.
- **§Gameplay 5 Track Design Format** — new subsections "Terrain surface types" (6-surface enum + preset table) and "Zone-based terrain" (v1 hills-01 four zones combining geometry × surface).
- **§Gameplay 6 Deterministic Simulation** — swap events are tick-indexed.
- **§Gameplay 7 Difficulty & Progression** — new modifier options (`single-wheel` purist mode, `swap-capped`).
- **§Gameplay 8 Edge Cases** — four new rows for mid-race conditions.
- **§Gameplay 9 Performance Budget** — wheel rebuild cost analysis (twin-wheel: ~2-4 ms per swap frame).
- **§Multiplayer 5 Ghost Replay Format** — binary layout stores `wheels[]` not a single polygon. Size grew from ~1.3 KB to ~1.5 KB median. **AWD does not change the blob format** — one polygon per swap applies to both axles on decode.
- **§Multiplayer 8 Layer 2/3** — structural checks validate every polygon in `wheels[]` + swap_tick monotonicity/cooldown; validator re-sim applies swaps at recorded ticks and applies surface-friction contact filter.
- **§Graphics 5 Car Body Design** — rewritten: both wheel wells render the drawn polygon; rear cartoon circle is gone. Two visually-identical wheels.
- **§Graphics 6 Terrain Rendering** — fills, cross-hatches, and optional surface motifs are per-surface. Grass strip suppressed on ice/snow/water/rock. Ink edge constant for silhouette consistency.
- **§Graphics 7 Ghost Rendering** — both ghost wheels crossfade in sync at each swap tick.
- **§Graphics 8 Animations** — three new rows (mid-race wheel swap, ghost wheel swap, cooldown gauge).
- **§Graphics 9.4 Race HUD** — redrawn ASCII wireframe with the always-on draw overlay at bottom + swap counter in HUD.
- **§Testing 3 Layer 2** — goldens JSON shape changed to `wheels[]`; six new swap-scenario goldens added.
- **§Roadmap Phase 1** — mid-race redraw is now a v1 core deliverable; tutorial ghosts must demo it.

## Authoritative Sources

- **Plan:** `/home/coding/drawrace/docs/plan/plan.md` — the source of truth. **Not frozen this pass** because the revision is the point; but also do not add your own gameplay ideas — stick to the spec.
- **PROGRESS.md** — out of date; last updated before the redraw pass. Update it as you close beads.
- **Environment:** `/home/coding/CLAUDE.md` — ADB/Pixel 6, kubectl, Argo, beads.
- **GitHub:** `https://github.com/jedarden/drawrace` — push on every iteration.

## Working Directory

`/home/coding/drawrace`

## Work queue

Everything lives under two epics:

**Epic `drawrace-vgn.8` — Mid-race wheel redraw.** 13 active child beads, dep-graphed so work can run in parallel where possible. Start here unless a bug elsewhere is actively blocking a user:

| Bead | P | Title | Blocked by |
|---|---|---|---|
| `drawrace-vgn.8.1` | P0 | `wheel_swaps[]` ghost-blob binary layout — client encoder + validator parser | (root) |
| `drawrace-vgn.8.2` | P0 | Wheel hot-swap procedure in engine-core (tick-boundary body swap) | (root) |
| `drawrace-vgn.8.3` | P0 | Race-screen draw overlay — always-on + pointer-capture isolation | 8.2 |
| `drawrace-vgn.8.12` | P0 | **Both wheels use the drawn polygon (AWD)** — engine-core + chassis density | (root) |
| `drawrace-vgn.8.13` | P0 | **Track surface types (ice/snow/water/mud/rock)** + `surfaces[]` schema + contact filter | (root) |
| `drawrace-vgn.8.14` | P0 | **hills-01 v2** — combine zones with surface types (icy incline, snowy rocks, water+descent) | 8.13 |
| `drawrace-vgn.8.4` | P1 | Validator re-sim applies `wheel_swaps[]` at recorded ticks | 8.1, 8.2, 8.13 |
| `drawrace-vgn.8.5` | P1 | Ghost playback visibly swaps wheels at recorded ticks (both axles) | 8.2, 8.12 |
| `drawrace-vgn.8.7` | P1 | Layer 2 goldens — add 6 new mid-race-swap scenarios | 8.2 |
| `drawrace-vgn.8.6` | P1 | Rebuild tutorial ghosts with ≥1 mid-race swap | 8.1, 8.2, 8.5, 8.14 |
| `drawrace-vgn.8.11` | P1 | Camera look-ahead: next zone visible ≥4s before chassis enters it | 8.14 |
| `drawrace-vgn.8.8` | P2 | Phone-smoke (Layer 9) exercises mid-race redraw | 8.3, 8.4, 8.5, 8.12, 8.13, 8.14 |
| `drawrace-vgn.8.9` | P2 | Ghost format migration — flag legacy single-wheel ghosts | 8.1 |

*(drawrace-vgn.8.10 — the original "zone redesign geometry-only" bead — is closed, superseded by 8.14 which combines zones with surface types.)*

**Standalone bead `drawrace-vgn.9` — P1 rendering bug: racers below the road, should be above it.** Quick independent fix — please pick this up between larger tasks.

Run `~/.local/bin/br ready` at the top of every iteration to see the current ready set (unblocked, open).

## ADB is wired to a real Pixel 6 — keep using it

Nothing about ADB access has changed. Reminder:

- **Device Tailscale IP:** `100.88.10.113`
- **This host's Tailscale IP:** `100.72.170.64` (the phone reaches here for the dev bundle)
- **Health check:** `adb-check`
- **Screen:** 1080×2400 portrait, **Chrome package:** `com.android.chrome`

Proven workflow from earlier passes (reference scripts at `/tmp/drawrace-*.py`):

```bash
# Build and serve the bundle on Tailscale (NOT localhost, so insecure-context bugs surface)
cd /home/coding/drawrace && pnpm build
cd apps/web/dist && python3 -m http.server 5180 --bind 0.0.0.0 &

# Cold-boot Chrome on the phone
adb shell am force-stop com.android.chrome
adb shell am start -a android.intent.action.VIEW -d 'http://100.72.170.64:5180/?v=1' com.android.chrome

# For scripted input use Chrome DevTools Protocol, NOT `adb shell input swipe`
adb forward tcp:9222 localabstract:chrome_devtools_remote
# Then dispatch synthetic PointerEvents via websocket — see /tmp/drawrace-draw-circle.py for the pattern
```

## Per-iteration workflow

1. `cd /home/coding/drawrace && git pull --ff-only`.
2. `~/.local/bin/br ready` — see the unblocked queue.
3. Pick the highest-priority ready bead. Mark `in_progress --assignee marathon`.
4. **Read the referenced plan sections before coding.** The plan was revised 2026-04-24; do not work from memory of the old spec.
5. For bugs: reproduce on the phone first, capture `before.png`. For features: capture a "before/after" visual where the feature has visible behaviour.
6. Implement. Run the relevant tests: `pnpm test`, `pnpm test:e2e`, `cargo test`.
7. **Re-run the phone-smoke against the change if the bead touches user-visible behaviour** (which most of this pass does). Capture `after.png`.
8. `git add <specific paths> && git commit -m "<bead-id>: <short>"` with `Closes: drawrace-vgn.8.X` (or `.9`) in the commit trailer.
9. `git push origin main`.
10. `~/.local/bin/br close drawrace-vgn.8.X` with a comment attaching the phone-smoke output + before/after screenshots.
11. Update `PROGRESS.md` when a user-facing capability lands (not every bead).
12. **End the iteration.** One bead per iteration.

## Hard rules

- **The plan is the source of truth.** If the code contradicts the plan, the code is wrong.
- **No bead closes without a phone-smoke when the bead affects user-visible behaviour.**
- **No GitHub Actions, no K8s Jobs/CronJobs, no direct `kubectl apply`.** K8s YAMLs go to `jedarden/declarative-config` via PR.
- **Never force-push. Never `--no-verify`. Never skip hooks.**
- **`Math.random` remains banned in `packages/engine-core`.**
- **Physics changes bump `PHYSICS_VERSION` + regenerate goldens.** The hot-swap procedure (drawrace-vgn.8.2) is NOT a physics change — it's a new input shape to the same physics engine — so no bump is required. Adding the new Layer 2 scenarios (drawrace-vgn.8.7) is similarly not a bump.
- **Do not edit existing bead definitions retroactively.** Add a comment, don't rewrite the description.
- **Phone-smoke screenshots go under `e2e/phone-smoke/baselines/`.** Transient per-iteration screenshots go under `.marathon/artifacts/` (gitignored).

## Done for this pass

`drawrace-vgn.8` (the mid-race redraw epic) closes when:

1. All 13 sub-beads closed with evidence.
2. A single cold-boot phone-smoke on the Pixel 6 demonstrates: cold load → draw initial wheel → race starts with **twin drawn wheels** visible on the car → observe zone A (normal flats) → redraw into zone-B-optimal shape (angular/teeth) before entering the **icy incline** → observe the twin hot-swap → survive zone C (snowy rocks) and D (water + jump) → finish in a time faster than a matched single-wheel-no-redraw baseline.
3. PROGRESS.md reflects the new mechanic accurately, including AWD, surface types, and the mid-race redraw.
4. `drawrace-vgn.9` (cars-below-road render bug) closed separately with a before/after phone screenshot.
5. Validator and client re-sim produce `|serverFinishTicks − clientFinishTicks| ≤ 2 ticks` on every multi-wheel golden, including the new surface-type scenarios from 8.13.

## When in doubt

Re-read the relevant section of `plan.md`. The plan was revised carefully on 2026-04-24; a disagreement between your intuition and the plan means the intuition is probably wrong for *this project specifically*. If you find a genuine gap, open a new bead `plan-gap: <title>` and continue with the work.
