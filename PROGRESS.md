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
| Layer 3 — Rendering Snapshots | Configured | Playwright snapshot tests in `e2e/snapshot.spec.ts` |
| Layer 4 — E2E Input | Configured | Playwright game tests in `e2e/game.spec.ts` |
| Layer 5 — Backend Contract | Passing (10 tests) | Rust validator structural tests |
| Layer 6 — Replay Verification | Implemented | Server-side re-sim against submitted ghosts |
| Layer 7 — Perf Budget | Configured | CDP CPU throttling perf tests in `e2e/perf.spec.ts` |
| Layer 8 — Load/Chaos | Configured | k6 load test scripts in `load/` |
| Layer 9 — Phone Smoke | Built, failing | ADB+CDP harness drives real Pixel 6; fails on playability bugs below |

## Real-Device Playability (drawrace-vgn.7)

The game does not yet play on a real phone. Headless tests all pass; the phone-smoke
harness (`e2e/phone-smoke/`) catches the gaps that desktop tests cannot.

### Known playability bugs (detected by phone-smoke)

- **Race init fails on Android Chrome**: `InvalidStateError: The source image could not be decoded`
  when `createImageBitmap()` processes SVG hill assets served over plain HTTP. The race
  canvas stays blank at the countdown screen.

### Remaining work (drawrace-vgn.7)

| Bead | Priority | Status |
|------|----------|--------|
| drawrace-vgn.7.4 — Phone-smoke harness | P0 | Done |
| drawrace-vgn.7.1 — crypto.randomUUID polyfill | P0 | Closed (premature) |
| drawrace-vgn.7.2 — Race canvas blank on Android Chrome | P0 | Closed (premature) |
| drawrace-vgn.7.3 — Draw canvas no live stroke preview | P1 | Closed (premature) |
| drawrace-vgn.7.5 — First-run ephemeral mode | P1 | Closed (premature) |
| drawrace-vgn.7.6 — WorkflowTemplate rounds 3-5 | P2 | Open |
| drawrace-vgn.7.7 — Validator 8080/8081 port split | P2 | Open |

## Current State

All phases code-complete. Tests passing (`pnpm test`: 97/97, `cargo test`: 13/13).
Build succeeds. Bundle: ~126KB gzipped (well under 400KB budget).
**Phone-smoke FAILS** — race init bug must be fixed before declaring "all phases complete."
