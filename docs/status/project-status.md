# DrawRace Project Status

**Last Updated:** 2026-04-22
**Current Phase:** Phase 3 Complete → Phase 4 (Beta) Blocked on Operational Tasks

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
- Postgres schema + migrations (sqlx): `players`, `ghosts`, `submissions`, `names`
- K8s manifests in repo (namespace, deployments, ingress, certificates, sealed-secrets)
- Frontend API integration (submit, fetch ghosts, leaderboard context)
- Seed pool: dev-recorded ghosts bundled for launch

### ✅ Phase 3: Polish — COMPLETE (Code-Level)
All visual polish deliverables implemented:
- ✅ Wobble cosmetic stroke on wheel (Renderer.ts)
- ✅ Parallax background layers (far/near hills)
- ✅ Cross-hatch terrain fill with grass strip and tuft sprites
- ✅ Dust particle system, countdown animation, finish-line confetti
- ✅ Caveat + Patrick Hand webfonts (loaded in index.html)
- ✅ Accessibility pass: WCAG AA audit, `prefers-reduced-motion`, haptics, ARIA
- ✅ Optional sound pack (synthesized sounds via Web Audio API)
- ✅ Low-end device fallbacks (particle disable, ghost-count drop, 30Hz sim fallback)
- ✅ Playwright E2E suite (game.spec.ts, a11y.spec.ts)
- ✅ Golden physics tests (golden.test.ts)

**Phase 3 Exit Criteria Status:**
- ✅ Visual comparison against plan shows parity
- ✅ WCAG AA audit passes (automated via @axe-core/playwright)
- ⚠️ Redmi 9 30fps verification - needs real-device testing
- ⚠️ CI with all 9 test layers - partial (see CI Test Matrix below)

### ⏸️ Phase 4: Beta — BLOCKED (Operational Tasks)
**Blocker:** Requires production infrastructure deployment and coordination

Remaining deliverables (all operational, not code):
1. **Infrastructure Deployment**
   - Deploy `drawrace-api` and `drawrace-validator` to production cluster
   - Configure Cloudflare Pages production project
   - Set up DNS records: `beta.drawrace.example` → Cloudflare, `api.drawrace.example` → cluster
   - Configure monitoring dashboards and alerts (Grafana, Prometheus)

2. **Beta Testing Infrastructure**
   - Create invite link / landing page
   - Set up feedback collection (Google Form or `/feedback` endpoint)
   - Configure replay-mismatch dashboard alerts
   - Wire alerts to on-call email

3. **Load & Chaos Testing**
   - Run k6 load tests against staging
   - Execute chaos tests (pod failure scenarios)
   - Verify client retry behavior

4. **Beta Execution**
   - Invite 20-40 testers
   - Monitor replay-mismatch rate (< 0.5% target)
   - Collect top-30 real beta times for launch seed pool

**Exit Criteria:**
- 0 crash reports in last 48h of beta
- Replay-mismatch rate < 0.5%
- No WCAG regressions
- Load test passes thresholds

### ⏸️ Phase 5: Launch — BLOCKED (Awaiting Phase 4)
**Blocker:** Cannot proceed until Beta phase completes

Remaining deliverables:
1. **DNS Cutover**
   - `drawrace.example` → Cloudflare Pages production
   - Verify TLS certificates

2. **Launch Preparation**
   - Add PWA install instructions to landing page
   - Prepare blog post / HN announcement
   - Record monitoring baselines (QPS, submission rate, bucket distribution)

3. **Post-Launch**
   - 48h on-call watch shift
   - Monitor for P0/P1 alerts

**Exit Criteria:**
- Public URL resolves and works on iOS Safari + Android Chrome
- First dozen public submissions propagate to leaderboard
- No P0/P1 incidents in first 24h

## CI Test Matrix

| Layer | Test Type | Status | Notes |
|-------|-----------|--------|-------|
| 1 | Unit Tests (Vitest) | ✅ COMPLETE | `pnpm test` passes |
| 2 | Golden Physics | ✅ COMPLETE | `golden.test.ts` with determinism |
| 3 | Rendering Snapshots | ❌ MISSING | Needs Playwright + pixelmatch |
| 4 | E2E (Playwright) | ✅ COMPLETE | `game.spec.ts`, `a11y.spec.ts` |
| 5 | Backend Contract | ❌ MISSING | Needs Rust backend tests |
| 6 | Replay Verification | ✅ COMPLETE | Validator crate tests |
| 7 | Performance Budget | ⚠️ PARTIAL | size-limit configured, not enforced in CI |
| 8 | Load & Chaos | ❌ MISSING | Needs k6 scripts, staging env |
| 9 | Device Matrix | ❌ MISSING | Needs real-device testing |

## Known Technical Debt

1. **Snapshot Tests (Layer 3)**: Not implemented. Requires Playwright screenshot testing with pixelmatch against pinned container image.

2. **Backend Contract Tests (Layer 5)**: Not implemented. Requires Rust backend integration tests.

3. **Performance Budget Enforcement**: size-limit is configured but not enforced in CI pipeline.

4. **Load Testing Infrastructure**: k6 scripts not written; staging environment not deployed.

5. **Real Device Testing**: No automated real-device testing (Pixel 6 ADB mentioned in CLAUDE.md but not integrated into CI).

## v1 Cut Line Compliance

Per plan, the following are explicitly **OUT** of v1:
- ✅ Multiple tracks (one track launches)
- ✅ Accounts, login, password, email
- ✅ Real-time multiplayer (architecture ready, not v1)
- ✅ Custom car bodies / cosmetics
- ✅ Paid features, IAP, ads
- ✅ Desktop-first UX (desktop works but not designed for)
- ✅ Leaderboard friends / social features
- ✅ Wheel-shape constraints modes (post-v1 progression)

## Next Steps

**To proceed to Phase 4 (Beta):**

1. **Infrastructure Team** needs to:
   - Deploy K8s manifests to production cluster
   - Configure Cloudflare Pages production project
   - Set up DNS records
   - Configure monitoring and alerting

2. **Dev Team** should:
   - Implement missing CI test layers (3, 5, 7, 8, 9) before beta
   - Set up staging environment for load testing
   - Create beta invite landing page

3. **Product** needs to:
   - Recruit 20-40 beta testers
   - Set up feedback collection mechanism
   - Plan beta testing timeline (1 week per plan)

**Estimated Phase 4 Duration:** 1 week (assuming infrastructure is ready)

**Estimated Phase 5 Duration:** 0.5 week (launch execution)

## Code Repository Status

- **Main Branch:** `main`
- **Recent Commits:**
  - `c0e4a1d` phase3: visual polish — wobble stroke, cross-hatch terrain, grass tufts, dust/confetti, canvas countdown
  - `d45176f` phase2: frontend API integration — matchmake, submit, ghost cache, k8s manifests
  - `ea1a360` phase2: validator binary with structural validation, Dockerfiles, migration 002
  - `b773cb4` phase2: leaderboard context, matchmake endpoints, rate limiting, unit tests

**Uncommitted Changes:**
- `apps/web/src/DrawScreen.tsx` (modified)
- Various untracked files: `.argo/`, `.beads/`, `e2e/`, `playwright.config.ts`

## Git Status

```
M apps/web/src/DrawScreen.tsx
?? .argo/
?? .beads/
?? .needle-predispatch-sha
?? apps/web/src/Sound.ts
?? docs/notes/features.md
?? docs/research/2d5-layout-visuals.md
?? docs/research/draw-wheel-prior-art.md
?? docs/research/ghost-replay-multiplayer.md
?? docs/research/touch-drawing-input.md
?? e2e/
?? playwright.config.ts
```

## Contact

For questions about this status or to proceed to Phase 4, contact the project lead.
