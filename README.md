# DrawRace

A mobile-first **draw-to-race PWA** where the polygon you draw becomes your car's wheel physics.

Draw a wheel shape with your finger, then race it down a hand-crafted physics track against ghost opponents. The skill ceiling is shape optimization — a near-perfect circle cruises flats, angular shapes claw up icy inclines, large wheels smooth out rocky terrain. You can redraw mid-race to adapt to changing conditions.

## Architecture

**Monorepo** (pnpm workspaces):

```
apps/web/                    — Vite+React PWA frontend
packages/engine-core/         — Deterministic Planck.js physics core
packages/bot/                 — Gameplay bot harness
crates/api/                   — Axum HTTP server (submissions, leaderboard, matchmake)
crates/validator/             — Redis queue worker (ghost re-sim anti-cheat)
crates/live/                  — Real-time race coordination
crates/update-ghosts/         — Reference-ghost refresh tool
k8s/                          — Kubernetes manifests + Argo WorkflowTemplates
e2e/                          — Playwright E2E + phone-smoke (Pixel 6 over ADB)
load/                         — k6 load tests
monitoring/                   — Grafana dashboards
seeds/                        — Matchmaking seed ghosts
```

**Backend:** Rust/axum on Rackspace Spot Kubernetes (Garage S3 for ghost blobs, Postgres for leaderboard, Redis for cache/queue).

**Frontend:** Static bundle on Cloudflare Pages, Service Worker + IndexedDB for offline ghost cache.

## Dev Quickstart

```bash
# Install dependencies
pnpm install

# Unit tests (Vitest)
pnpm test

# Type checking + linting
pnpm lint

# Build all packages
pnpm build

# E2E tests (Playwright)
pnpm test:e2e

# Rust backend tests
cargo test -p drawrace-validator

# Golden file regeneration (after intentional physics changes)
just regen-golden

# Snapshot tests (pinned container for deterministic rendering)
just snap
```

## Key Invariants

**Deterministic physics** is the keystone — bit-exact ghost replay without storing per-frame positions.

- **`PHYSICS_VERSION`** constant in `packages/engine-core/src/version.ts` — bumps on intentional physics changes
- **Golden files** under `packages/engine-core/golden/` — regression tests must match exactly
- **`Math.random()` banned** in engine code (lint-enforced) — all randomness routes through seeded PRNG
- **Fixed timestep:** `1/60 s` regardless of display refresh rate

**Bundle budget:** `<400KB gzipped` initial payload (currently ~126KB).

## Gameplay

- **Three tracks:** `hills-01`, `dunes-03`, `canyon-02`
- **Surface types:** normal, ice, snow, water, mud, rock (different friction, restitution, drag)
- **Mid-race redraw:** Always-on draw overlay lets you swap wheels on the fly (500ms cooldown, 20-swap cap)
- **AWD:** Both front and rear wheels use your drawn polygon, each with independent motor
- **Stuck-DNF:** Race ends after 10 full wheel rotations without 0.5m progress

## Documentation

- **[Plan](docs/plan/plan.md)** — Full implementation plan (gameplay, physics, backend, testing, roadmap)
- **[Progress](PROGRESS.md)** — Phase status and completion summary
- **[Testing docs](docs/testing/)** — Test layer descriptions and CI pipeline

## Test Status

- ✅ Unit (Vitest): 97 tests passing
- ✅ Physics golden: 23 reference wheels, bit-exact determinism
- ✅ E2E (Playwright): 75 tests passing
- ✅ Phone smoke: Pixel 6 cold-boot green (ADB over Tailscale)
- ✅ Backend contract: Rust validator structural tests
- ✅ Perf budget: Median frame time ≤12ms @ 6× CPU throttle

## License

MIT
