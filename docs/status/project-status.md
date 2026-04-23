# DrawRace Project Status

**Last Updated:** 2026-04-23
**Current Phase:** Phase 4 (Beta) — Code Complete, Awaiting Operational Deployment

## Phase Completion Status

### ✅ Phase 0: Foundation — COMPLETE
- Monorepo with pnpm workspaces
- `engine-core` package with deterministic physics
- Seeded PRNG (mulberry32), injected clock, fixed 1/60s timestep
- Lint rule banning `Math.random` in engine code
- Vitest running unit tests and golden physics tests
- `PHYSICS_VERSION` constant and golden file regeneration

### ✅ Phase 1: Playable MVP — COMPLETE
- Vite + React app shell
- Draw Screen: pointer capture → Douglas-Peucker → centroid → decomposition → preview
- Physics integration: Planck.js with wheel-chassis via WheelJoint + motor
- Canvas 2D renderer with scene layers
- v1 track JSON: `hills-01` (~40s target time)
- 3 tutorial ghosts bundled as assets
- Result Screen with time, ghost comparison, Retry
- Service Worker caching shell + assets
- Web App Manifest (installable PWA)
- Cloudflare Pages project bootstrapped

### ✅ Phase 2: Backend & Multiplayer — COMPLETE
- `apps/api` (axum): `/v1/submissions`, `/v1/leaderboard/*`, `/v1/ghosts/*`, `/v1/matchmake/*`, `/v1/names`, `/v1/health`, `/v1/metrics`
- `apps/validator`: pulls jobs from Redis, loads engine-core WASM, re-sims and writes verdict
- Postgres schema + migrations (sqlx): `players`, `ghosts`, `submissions`, `names`, `feedback`
- K8s manifests in repo (namespace, deployments, ingress, certificates, sealed-secrets)
- Frontend API integration (submit, fetch ghosts, leaderboard context)
- Seed pool: dev-recorded ghosts bundled for launch

### ✅ Phase 3: Polish — COMPLETE
- Wobble cosmetic stroke on wheel (Renderer.ts)
- Parallax background layers (far/near hills)
- Cross-hatch terrain fill with grass strip and tuft sprites
- Dust particle system, countdown animation, finish-line confetti
- Caveat + Patrick Hand webfonts (loaded in index.html)
- Accessibility: WCAG AA audit, `prefers-reduced-motion`, haptics, ARIA
- Synthesized sound effects via Web Audio API (Sound.ts)
- Low-end device fallbacks (particle disable, ghost-count drop, 30Hz sim fallback)
- Playwright E2E suite (game.spec.ts, a11y.spec.ts)
- Golden physics tests (golden.test.ts)

### ✅ Phase 4: Beta — Code Deliverables Complete

**Code deliverables (2026-04-22):**
- ✅ Beta landing page with invite flow, how-to-play, PWA install instructions (`LandingScreen.tsx`)
- ✅ Feedback endpoint (`POST /v1/feedback`) with rate limiting and Postgres storage
- ✅ Feedback UI on landing screen (bug/feature/other categories)
- ✅ k6 load test script (`load/submit.js`) — ramping-arrival-rate 50→2000 RPS, p95<400ms threshold
- ✅ k6 chaos test (`load/chaos.js`) — constant 500 RPS for pod-kill resilience testing
- ✅ Chaos test orchestration (`load/chaos-test.sh`) — kills api pod, monitors recovery, checks error thresholds
- ✅ Grafana dashboard (`monitoring/drawrace-dashboard.json`) — submission rate, rejection rate, validator queue, latency, replay mismatch, bucket miss
- ✅ Prometheus ServiceMonitor + alert rules (`k8s/servicemonitor.yaml`) — rejection >10%, queue >100, api unavailable, replay mismatch >0.5%
- ✅ Alertmanager email routing (`k8s/alertmanager-config.yaml`) — drawrace alerts → email
- ✅ Argo Workflows CI templates (`.argo/`) — Kaniko builds for api + validator images

**Remaining operational tasks (not code):**
1. Deploy K8s manifests to production cluster via ArgoCD
2. Configure Cloudflare Pages production project for web app
3. Set up DNS: `api.drawrace.ardenone.com` → cluster ingress
4. Import Grafana dashboard into production Grafana
5. Recruit 20-40 beta testers
6. Run k6 load test against staging
7. Execute chaos test against staging
8. Monitor replay-mismatch rate during beta (< 0.5% target)
9. Collect top-30 real beta times for launch seed pool

**Exit Criteria:**
- 0 crash reports in last 48h of beta
- Replay-mismatch rate < 0.5%
- No WCAG regressions
- Load test passes thresholds (p95 < 400ms, error rate < 1%)

### ⏸️ Phase 5: Launch — Code Complete, Blocked on Phase 4

Code deliverables already in place:
- ✅ PWA install instructions on landing screen
- ✅ Platform-specific guidance (iOS, Android, Desktop)

Remaining operational: DNS cutover, blog post, 48h on-call watch.

## CI Test Matrix

| Layer | Test Type | Status | Notes |
|-------|-----------|--------|-------|
| 1 | Unit Tests (Vitest) | ✅ COMPLETE | `pnpm test` passes (28 tests) |
| 2 | Golden Physics | ✅ COMPLETE | `golden.test.ts` with 23 reference wheels, bit-exact determinism |
| 3 | Rendering Snapshots | ✅ COMPLETE | `e2e/snapshot.spec.ts` with pixelmatch, Docker-pinned container |
| 4 | E2E (Playwright) | ✅ COMPLETE | `game.spec.ts`, `a11y.spec.ts`, `debug.spec.ts` |
| 5 | Backend Contract | ✅ COMPLETE | `crates/api/tests/contract_test.rs` (33 tests, 23 pass, 10 need DB) |
| 6 | Replay Verification | ✅ COMPLETE | Validator crate tests |
| 7 | Performance Budget | ✅ COMPLETE | `e2e/perf.spec.ts` + size-limit: engine 307B/100KB, web 124KB/400KB |
| 8 | Load & Chaos | ✅ SCRIPTS READY | k6 load + chaos scripts; needs staging env |
| 9 | Device Matrix | ⏸️ DEFERRED | Requires real-device testing (operational) |

## v1 Cut Line Compliance

All non-goals respected — no scope creep:
- Single track only, no accounts/login, no real-time multiplayer, no cosmetics, no monetization, no desktop-first UX, no social features, no wheel constraints.

## Infrastructure

| Component | Config | Status |
|-----------|--------|--------|
| API Deployment | `k8s/api-deployment.yaml` (2 replicas, topology spread) | Ready to deploy |
| Validator Deployment | `k8s/validator-deployment.yaml` (1 replica, HPA 1-3) | Ready to deploy |
| Ingress | `k8s/ingress.yaml` (Traefik + cert-manager, `api.drawrace.ardenone.com`) | Ready to deploy |
| Postgres | `k8s/postgres-cluster.yaml` (CloudNativePG) | Ready to deploy |
| Redis | `k8s/redis.yaml` (Redis 8 Alpine) | Ready to deploy |
| Monitoring | `k8s/servicemonitor.yaml` + `monitoring/` | Ready to deploy |
| Alert Routing | `k8s/alertmanager-config.yaml` | Ready to deploy |
| CI/CD | `.argo/` workflow templates | Ready |
| Network Policy | `k8s/networkpolicy.yaml` | Ready to deploy |
