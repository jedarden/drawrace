# DrawRace — Marathon Coding Instruction (Mid-race Redraw Pass)

You are the implementation agent for **DrawRace**, a mobile-first wheel-drawing racing PWA. The earlier "playability pass" closed the real-device bugs that kept the game from loading on a phone. The current pass implements the **mid-race wheel redraw** mechanic — the core gameplay loop revision driven by play-testing on 2026-04-24.

## What changed in plan.md on 2026-04-24

The plan (`docs/plan/plan.md`) was revised from a one-shot "commit a wheel, then spectate the race" design to a continuous-redraw design: the player can redraw the wheel at any moment during the race, the new shape hot-swaps into the physics world at the next tick boundary, and the track has **zone-based terrain** that requires adapting the wheel shape to stay fast.

Read these sections in order before you start. Do not skim — the binary layout changed, the edge cases changed, and the perf budget changed.

- **§Gameplay 1 Core Game Loop** — no longer three-phase-strict. New constraints: 80ms hot-swap deadline, 500ms cooldown between swaps, 20-swap cap.
- **§Gameplay 2 Wheel-Drawing Input Pipeline** — new subsection "Mid-race draw overlay" (always-on bottom-40% overlay during the Race phase).
- **§Gameplay 3 Shape-to-Physics Translation** — new subsection "Wheel hot-swap procedure" with tick-boundary body-swap pseudocode.
- **§Gameplay 5 Track Design Format** — new subsection "Zone-based terrain" with four zones A/B/C/D in hills-01.
- **§Gameplay 6 Deterministic Simulation** — swap events are tick-indexed.
- **§Gameplay 7 Difficulty & Progression** — new modifier options (`single-wheel` purist mode, `swap-capped`).
- **§Gameplay 8 Edge Cases** — four new rows for mid-race conditions.
- **§Gameplay 9 Performance Budget** — wheel rebuild cost analysis.
- **§Multiplayer 5 Ghost Replay Format** — binary layout now stores `wheels[]` not a single polygon. Size grew from ~1.3 KB to ~1.5 KB median.
- **§Multiplayer 8 Layer 2/3** — structural checks validate every polygon in `wheels[]` + swap_tick monotonicity/cooldown; validator re-sim applies swaps at recorded ticks.
- **§Graphics 7 Ghost Rendering** — ghosts visibly swap wheels mid-race (200ms crossfade).
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

**Epic `drawrace-vgn.8` — Mid-race wheel redraw.** 11 child beads, dep-graphed so work can run in parallel where possible. Start here unless a bug elsewhere is actively blocking a user:

| Bead | P | Title | Blocked by |
|---|---|---|---|
| `drawrace-vgn.8.1` | P0 | `wheel_swaps[]` ghost-blob binary layout — client encoder + validator parser | (root) |
| `drawrace-vgn.8.2` | P0 | Wheel hot-swap procedure in engine-core (tick-boundary body swap) | (root) |
| `drawrace-vgn.8.3` | P0 | Race-screen draw overlay — always-on + pointer-capture isolation | 8.2 |
| `drawrace-vgn.8.10` | P0 | Redesign hills-01 as four terrain zones A/B/C/D | (root) |
| `drawrace-vgn.8.4` | P1 | Validator re-sim applies `wheel_swaps[]` at recorded ticks | 8.1, 8.2 |
| `drawrace-vgn.8.5` | P1 | Ghost playback visibly swaps wheels at recorded ticks | 8.2 |
| `drawrace-vgn.8.7` | P1 | Layer 2 goldens — add 6 new mid-race-swap scenarios | 8.2 |
| `drawrace-vgn.8.6` | P1 | Rebuild tutorial ghosts with ≥1 mid-race swap | 8.1, 8.2, 8.5 |
| `drawrace-vgn.8.11` | P1 | Camera look-ahead: next zone visible ≥4s before chassis enters it | 8.10 |
| `drawrace-vgn.8.8` | P2 | Phone-smoke (Layer 9) exercises mid-race redraw | 8.3, 8.4, 8.5 |
| `drawrace-vgn.8.9` | P2 | Ghost format migration — flag legacy single-wheel ghosts | 8.1 |

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

1. All 11 sub-beads closed with evidence.
2. A single cold-boot phone-smoke on the Pixel 6 demonstrates: cold load → draw initial wheel → race starts → observe terrain zone A → redraw into zone-B-optimal shape before entering zone B → observe the hot-swap → finish in a time faster than a matched single-wheel baseline.
3. PROGRESS.md reflects the new mechanic accurately.
4. `drawrace-vgn.9` (cars-below-road render bug) closed separately with a before/after phone screenshot.
5. Validator and client re-sim produce `|serverFinishTicks − clientFinishTicks| ≤ 2 ticks` on every multi-wheel golden.

## When in doubt

Re-read the relevant section of `plan.md`. The plan was revised carefully on 2026-04-24; a disagreement between your intuition and the plan means the intuition is probably wrong for *this project specifically*. If you find a genuine gap, open a new bead `plan-gap: <title>` and continue with the work.
