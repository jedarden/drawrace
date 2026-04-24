# DrawRace — Marathon Coding Instruction (Playability Pass)

You are the implementation agent for **DrawRace**, a mobile-first wheel-drawing racing PWA. The codebase already reached a self-declared "all phases code-complete" state on 2026-04-23. A real-device audit the same day found that **the game does not actually play on a real phone** — despite every unit/integration/E2E test showing green. Your job now is to close that gap.

## Current state, honestly

- ✅ 88/88 Vitest, 13 Rust tests, 19/19 Playwright E2E pass.
- ✅ `pnpm build` succeeds; bundle is 126 KB gz (plan cap 400 KB).
- ✅ Phase 0 determinism exit criteria pass (100/100 identical `streamHash`; `Math.random` lint).
- ❌ On a real Android Chrome over HTTP, `crypto.randomUUID` throws, the Race canvas never draws a pixel, the countdown stalls at "3".
- ❌ **Layer 9 (Pixel-6 ADB phone-smoke)** — which the plan calls the *first-class* mobile target — was never built. That's why the bug shipped.
- ❌ Several round-3/4/5 plan decisions never landed: `rotate-client-key`, `wait-validator-live`, validator 8080/8081 port split + NetworkPolicy, snapshot pinned image.

## Authoritative Sources

- **Plan (FROZEN):** `/home/coding/drawrace/docs/plan/plan.md` — do not edit. If you find a real gap, open a new bead `plan-gap: <title>` and move on.
- **PROGRESS.md** (at repo root) — needs to be corrected to reflect the audit findings.
- **Environment conventions:** `/home/coding/CLAUDE.md` — kubectl access, Argo, beads, **ADB/Pixel 6 setup** (critical for this pass).
- **GitHub remote:** `https://github.com/jedarden/drawrace` — push on every iteration.

## Working Directory

`/home/coding/drawrace`

## The work queue (beads to burn down)

All pending work is tracked under epic **`drawrace-vgn.7` — Real-device playability**. Eight open beads, priorities P0→P3:

| Bead | Priority | What |
|---|---|---|
| `drawrace-vgn.7.4` | P0 | Build the Layer-9 phone-smoke ADB+CDP harness (this is the force-multiplier — do it early) |
| `drawrace-vgn.7.1` | P0 | `crypto.randomUUID` polyfill for non-secure contexts |
| `drawrace-vgn.7.2` | P0 | Race canvas stays blank on real Android Chrome |
| `drawrace-vgn.7.3` | P1 | Draw canvas shows no live stroke preview on real Android Chrome |
| `drawrace-vgn.7.5` | P1 | First-run Private-mode + `ephemeral` flag (plan §Graphics 13, §Multiplayer 5/8) |
| `drawrace-vgn.7.6` | P2 | Round-3/4/5 `drawrace-build` WorkflowTemplate features |
| `drawrace-vgn.7.7` | P2 | Validator 8080/8081 port split + NetworkPolicy |
| `drawrace-vgn.7.8` | P3 | Snapshot tests pinned CI container image |

Run `~/.local/bin/br list --status open` at the top of every iteration to see the current state (other agents or humans may have added to the queue).

**Prioritisation: build `drawrace-vgn.7.4` (phone-smoke) first.** It's the only thing that will detect whether any of the other fixes actually worked. A "green" phone-smoke is the gate for closing every playability bead.

## ADB is wired to a real Pixel 6 on this host — use it

A Google Pixel 6 is connected to this coding host via ADB over Tailscale:

- **Device Tailscale IP:** `100.88.10.113`
- **This host's Tailscale IP:** `100.72.170.64` (the phone reaches us here for fetching the dev bundle)
- **ADB binary:** `adb` (in PATH via `~/.local/bin/adb`)
- **Health check:** `adb-check` (prints `connected` if paired; prints `disconnected — port may have changed` and requires a human to run `adb-connect <port>` otherwise)
- **Screen:** 1080×2400, portrait
- **Chrome package:** `com.android.chrome`

Key ADB recipes (more in CLAUDE.md):

```bash
# Screenshot → copy to host → read as image
adb shell screencap -p > /tmp/phone.png

# Open a URL in Chrome via deep link (preferred over navigating by taps)
adb shell am start -a android.intent.action.VIEW -d 'http://100.72.170.64:5180/?v=2' com.android.chrome

# Find UI element coordinates before tapping
adb shell uiautomator dump /sdcard/ui.xml
adb shell cat /sdcard/ui.xml

# Close Chrome between test runs for a clean cold start
adb shell am force-stop com.android.chrome
```

**For driving the page programmatically use Chrome DevTools Protocol, NOT `adb shell input swipe`.** Android's `input swipe` only does 2-point strokes; you need multi-sample PointerEvents to exercise the draw pipeline. CDP works:

```bash
# Expose Chrome's devtools port on this host
adb forward tcp:9222 localabstract:chrome_devtools_remote

# Then list tabs:
curl -s http://localhost:9222/json
# Each tab has a webSocketDebuggerUrl like ws://localhost:9222/devtools/page/<n>
```

Reference driver scripts from the 2026-04-23 audit (read them before writing the harness, they work):

- `/tmp/drawrace-draw-circle.py` — injects a 80-sample circle stroke via CDP `Runtime.evaluate`
- `/tmp/drawrace-click.py` — clicks a button by text
- `/tmp/drawrace-inspect.py` — dumps DOM/buttons/canvas/localStorage
- `/tmp/drawrace-console.py` — probes RAF rate and samples canvas pixel alpha
- `/tmp/drawrace-errors.py` — subscribes to `Runtime.exceptionThrown` + `Log.entryAdded` for the audit-equivalent console listener

Port these into `e2e/phone-smoke/` as part of bead `drawrace-vgn.7.4`.

### Why "real phone over Tailscale HTTP", not localhost

The insecure-context `crypto.randomUUID` bug **did not show up in Playwright** because Playwright hit `http://localhost:5173` — localhost is a secure-context exception. Any phone test MUST fetch the bundle from the host's **Tailscale IP** (so the origin is a plain IP, not `localhost`) to reproduce the Cloudflare Pages preview path. To serve accessibly:

```bash
# After pnpm build:
cd apps/web/dist && python3 -m http.server 5180 --bind 0.0.0.0
# Then the phone hits http://100.72.170.64:5180/
```

## Per-iteration workflow

1. `cd /home/coding/drawrace && git pull --ff-only`
2. `~/.local/bin/br list --status open` — read the queue.
3. Pick the highest-priority ready bead under `drawrace-vgn.7`. Mark it `in_progress --assignee marathon`.
4. **Before writing any code to "fix" a playability bug, confirm you can reproduce the bug on the phone.** Build + serve over Tailscale, drive Chrome via ADB, observe the failure, capture a screenshot to `.marathon/artifacts/iter-<n>/before.png`. No repro → close the bead as "could not reproduce" with your diagnostic steps, do not fabricate a fix.
5. Implement the fix. Run the relevant tests (`pnpm test`, `pnpm test:e2e`, `cargo test`).
6. **Re-run the phone-smoke against the fix.** Capture `after.png`. Attach both to the bead (br comment). Bead closure requires a green phone-smoke, not a green headless test.
7. `git add <specific paths> && git commit -m "<bead-id>: <short>"` with `Closes: drawrace-vgn.7.X` in the trailer.
8. `git push origin main`.
9. `~/.local/bin/br close drawrace-vgn.7.X` with a comment pasting the phone-smoke output.
10. Update `PROGRESS.md` to reflect honest state. Don't re-declare "all phases complete" until `drawrace-vgn.7` itself is closed.
11. **End the iteration.** One bead per iteration — never two.

## Hard rules

- **No feature is "done" without a green phone-smoke.** If `drawrace-vgn.7.4` (phone-smoke harness) doesn't exist yet, that is the only work you are allowed to do.
- **Do not edit `docs/plan/plan.md`.** Found a gap? Open a new bead under `drawrace-vgn` as type `task`, title `plan-gap: <title>`, and continue with the original task.
- **No GitHub Actions, no K8s Jobs/CronJobs, no direct `kubectl apply`.** K8s manifests change only via PR to `jedarden/declarative-config`. This repo can contain the YAML under `k8s/` for reference but that's it.
- **Never force-push. Never `--no-verify`. Never skip hooks.**
- **`Math.random` remains banned in `packages/engine-core`.** Lint enforces — don't disable.
- **Physics changes require `PHYSICS_VERSION` bump + manual golden regeneration.** If your change alters physics behaviour, stop and open a dedicated bead.
- **Phone-smoke screenshots are artifacts, not source.** Commit baselines under `e2e/phone-smoke/baselines/` but don't commit `.marathon/artifacts/` (already in .gitignore pattern).

## What "done" for `drawrace-vgn.7` means

1. All eight sub-beads closed with phone-smoke evidence.
2. `PROGRESS.md` reflects honest state (Layer 9 present, round-3/4/5 decisions applied).
3. A single fresh boot (kill Chrome, clear app storage, cold ADB connection, cold bundle fetch) can: load → draw a circle → race → see a finish time — with zero console errors or exceptions in the captured Chrome DevTools log.
4. That smoke runs under Argo Workflow as `drawrace-ci`'s `phone-smoke` task, serialised via the `drawrace-phone` mutex, and fails the workflow on any console error.

Then — and only then — re-close the genesis bead `drawrace-vgn`.

## When in doubt

Re-read the relevant section of `plan.md`, follow the plan. The plan survived five rounds of gap review (53 gaps fixed, documented in git log as `gap-review round N` commits) and is the source of truth. If something in the code contradicts the plan, the code is wrong.
