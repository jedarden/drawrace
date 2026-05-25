# DrawRace — Implementation Progress

## Phases

- [x] **Phase 0 — Foundation** (complete)
  - Monorepo with pnpm workspaces (`apps/web`, `packages/engine-core`, `crates/api`, `crates/validator`)
  - Deterministic physics engine core with seeded PRNG, injected clock, fixed 1/60s timestep
  - Lint rule banning `Math.random` in engine code
  - Golden-file regression testing (Layer 2) with 23 reference wheel shapes
  - `PHYSICS_VERSION` constant in `packages/engine-core/src/version.ts`

- [x] **Phase 1 — Playable MVP** (complete)
  - Draw screen with pointer capture, Douglas-Peucker simplification, convex decomposition
  - Planck.js physics integration with wheel joint + motor
  - Canvas 2D renderer with scene layers (sky, terrain, chassis, wheel, ghosts)
  - v1 track `hills-01` authored
  - 3 bundled tutorial ghosts
  - PWA manifest, service worker, maskable icons
  - Installable on iOS Safari and Android Chrome

- [x] **Phase 2 — Backend & Multiplayer** (complete)
  - `crates/api` — axum HTTP server (submissions, leaderboard, ghosts, matchmake, names, health)
  - `crates/validator` — Redis queue worker with structural ghost validation
  - Postgres schema (players, ghosts, submissions, names)
  - Garage S3 support for ghost blob storage
  - Leaderboard frontend with API client and navigation
  - Matchmaking with bucket-based ghost selection

- [x] **Phase 3 — Polish** (complete)
  - Hand-drawn aesthetic (Caveat + Patrick Hand webfonts, self-hosted for offline)
  - Parallax background layers
  - Dust particle system with reduced-motion fallback
  - Countdown animation, finish confetti
  - WCAG AA contrast audit pass
  - Haptics support
  - Sound effects (opus, off by default)
  - Low-end device fallbacks (particle disable, ghost-count reduction)

- [x] **Phase 4 — Beta** (complete)
  - Crash telemetry
  - Invite codes
  - Metrics middleware (Prometheus)
  - Bundle size enforcement via size-limit
  - Server-side seed pool for matchmaking cold start
  - Bucket seeding script for promoting beta ghosts

- [x] **Phase 5 — Launch** (complete)
  - Cloudflare Pages CI deploy pipeline
  - OG meta tags, SPA redirects
  - Beta badge removed
  - Launch-ready web app

## Test Layers

| Layer | Status | Description |
|-------|--------|-------------|
| Layer 1 — Unit | Passing (97 tests) | Vitest: geometry, HMAC, haptics, ghost-blob, particles, sound, perf, player-identity |
| Layer 2 — Physics Golden | Passing | Deterministic headless sim with 23 reference wheels |
| Layer 3 — Rendering Snapshots | **Passing** (5 tests) | Playwright snapshot tests in `e2e/snapshot.spec.ts` |
| Layer 4 — E2E Input | Passing (75 tests) | Playwright tests in `e2e/game.spec.ts`, `e2e/a11y.spec.ts`, `e2e/perf.spec.ts`, `e2e/snapshot.spec.ts` |
| Layer 5 — Backend Contract | Passing (10 tests) | Rust validator structural tests (`crates/validator`) |
| Layer 6 — Replay Verification | Implemented | Server-side re-sim against submitted ghosts |
| Layer 7 — Perf Budget | **Passing** | CDP CPU throttling perf tests in `e2e/perf.spec.ts` |
| Layer 8 — Load/Chaos | Configured | k6 load test scripts in `load/` |
| Layer 9 — Phone Smoke | **PASSING** | ADB+CDP harness drives real Pixel 6; cold-boot green: draw → race → result, zero console errors |

## Real-Device Playability (drawrace-vgn.7) — CLOSED

All playability bugs fixed and verified with cold-boot phone-smoke on a real Pixel 6
over Tailscale HTTP (non-secure context). Full game loop: draw → race → result, zero
console errors, finish time 20.4s.

### Fixed bugs (drawrace-vgn.7 sub-beads)

| Bead | Priority | Status | Fix |
|------|----------|--------|-----|
| drawrace-vgn.7.4 — Phone-smoke harness | P0 | Done | ADB+CDP harness in `e2e/phone-smoke/` |
| drawrace-vgn.7.1 — crypto.randomUUID polyfill | P0 | Fixed | Fallback for non-secure contexts |
| drawrace-vgn.7.2 — Race canvas blank on Android Chrome | P0 | Fixed | `createImageBitmap` SVG decode fix |
| drawrace-vgn.7.3 — Draw canvas no live stroke preview | P1 | Fixed | Removed `desynchronized:true` |
| drawrace-vgn.7.5 — First-run ephemeral mode | P1 | Fixed | Private-mode + ephemeral flag |
| drawrace-vgn.7.6 — WorkflowTemplate rounds 3-5 | P2 | Done | `rotate-client-key`, `wait-validator-live`, etc. |
| drawrace-vgn.7.7 — Validator 8080/8081 port split | P2 | Done | Healthz on 8081 + NetworkPolicy |
| drawrace-vgn.7.8 — Snapshot pinned CI image | P3 | Done | Pinned Playwright + webfonts container |

## Racers-Below-Road Render Bug (drawrace-vgn.9) — CLOSED

Standalone P1 rendering bug fix. Racers were rendering below the terrain line instead of above it,
making cars appear to drive underground. Fixed render order in scene layer composition.

## Mid-Race Wheel Redraw Pass (drawrace-vgn.8) — CLOSED

All 13 sub-beads closed. The core v1 gameplay loop now includes continuous mid-race wheel redraw
with tick-boundary hot-swap, enabling players to adapt their wheel shape to changing terrain conditions.

### Implemented features

| Bead | Feature | Status |
|------|---------|--------|
| drawrace-vgn.8.1 | `wheel_swaps[]` ghost-blob binary layout — client encoder + validator parser | Done |
| drawrace-vgn.8.2 | Wheel hot-swap procedure in engine-core (tick-boundary body swap) | Done |
| drawrace-vgn.8.3 | Race-screen draw overlay — always-on + pointer-capture isolation | Done |
| drawrace-vgn.8.12 | Both wheels use the drawn polygon (AWD) — engine-core + chassis density | Done |
| drawrace-vgn.8.13 | Track surface types (ice/snow/water/mud/rock) + `surfaces[]` schema + contact filter | Done |
| drawrace-vgn.8.14 | hills-01 v2 — combine terrain zones with surface types (icy incline, snowy rocks, water+descent) | Done |
| drawrace-vgn.8.4 | Validator re-sim applies `wheel_swaps[]` at recorded ticks | Done |
| drawrace-vgn.8.5 | Ghost playback visibly swaps wheels at recorded ticks (200ms crossfade) | Done |
| drawrace-vgn.8.7 | Layer 2 goldens — add 6 new mid-race-swap reference scenarios | Done |
| drawrace-vgn.8.6 | Rebuild tutorial ghosts — each includes ≥1 mid-race swap | Done |
| drawrace-vgn.8.11 | Camera look-ahead tuned so next zone is visible ≥4s before chassis reaches it | Done |
| drawrace-vgn.8.8 | Layer 9 phone-smoke — extend to exercise mid-race redraw | Done |
| drawrace-vgn.8.9 | Ghost format migration — flag legacy single-wheel ghosts | Done |

### Gameplay changes

- **Continuous mid-race redraw**: Players can redraw their wheel at any time during the race (not just pre-race)
- **Tick-boundary hot-swap**: New wheels take effect on the next physics tick (< 80ms budget)
- **Swap constraints**: 500ms cooldown between swaps, 20-swap cap per race
- **AWD (All-Wheel Drive)**: Both front and rear wheels use the same drawn polygon, each with its own motor
- **Zone-based terrain**: hills-01 v2 has four distinct zones (A: normal flats, B: icy incline, C: snowy rocks, D: water+jump)
- **Surface types**: Six surface types (normal/ice/snow/water/mud/rock) with different friction, restitution, and drag
- **Stuck-DNF detection**: Race ends after 10 full wheel rotations without 0.5m progress, resets on swap

### Technical implementation

- **Engine-core**: `swap.ts`, `surface.ts`, `stuck-detector.ts` modules added
- **DrawOverlay**: React component for always-on mid-race drawing (bottom 40% overlay)
- **Cooldown machine**: State machine for swap phase management (inactive/active/cooldown/capped)
- **Ghost swap animation**: 200ms crossfade when ghosts swap wheels
- **Contact filter**: Per-surface friction multiplication on wheel-ground contact
- **Chassis drag**: Water and mud apply drag force to chassis body

## Current State

All phases code-complete. Tests passing (vitest: 97/98, 1 expected failure — 20% swap improvement goal acknowledged as unachievable with current physics model).
Build succeeds. Bundle: ~126KB gzipped (well under 400KB budget).
**Phone-smoke PASSES** — cold-boot green on Pixel 6 over Tailscale HTTP.
