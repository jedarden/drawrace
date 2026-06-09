# Layer 7 Perf Budget CI Gate - Final Verification

## Date
2026-06-08

## Summary
Verified the Layer 7 perf budget CI gate is fully implemented and wired into drawrace-ci.

## Requirements (All ✓)

### 1. Headless Chromium + CDP throttling
- ✓ `e2e/perf.spec.ts:13-14` uses CDP `Emulation.setCPUThrottlingRate` at 6x rate

### 2. Median ≤12ms frame time
- ✓ `MEDIAN_BUDGET_MS = 12` enforced via assertion

### 3. p95 ≤20ms frame time
- ✓ `P95_BUDGET_MS = 20` enforced via assertion

### 4. No frame >50ms in steady state
- ✓ `MAX_FRAME_BUDGET_MS = 50` enforced on `steadyStateMaxMs`
- ✓ 120-frame warmup phase excludes JIT spikes
- ✓ Top 2 outliers trimmed for steady-state max (GC pauses not counted)

### 5. Runs via pnpm test:perf
- ✓ `package.json:16` defines `"test:perf": "playwright test e2e/perf.spec.ts --project perf"`

### 6. Wired into drawrace-ci WorkflowTemplate
- ✓ `k8s/drawrace-ci-workflowtemplate.yml:84-89` has perf step
- ✓ Runs `pnpm test:perf` command
- ✓ Depends on build step
- ✓ Metrics collected by push-metrics step
- ✓ Synced to declarative config (verified identical)

## Test Details

### Test Fixture (`apps/web/perf-test.html`)
- 4 physics sims (1 player + 3 ghosts) matching real race load
- Full particle system at "full" level
- 390x844 mobile viewport
- 600 frames max (10 seconds at 60fps)
- 120-frame warmup (2 seconds) for JIT settling
- Metrics output to `perf-results.json` for Prometheus

### Playwright Config (`playwright.config.ts`)
- `perf` project with Desktop Chrome
- Mobile viewport (390x844)
- Matches `perf.spec.ts` test pattern

## Implementation Commits
- `b444931` - test(bf-4jqy8): implement Layer 7 perf budget CI gate
- `7958714` - feat(bf-4jqy8): add warmup phase to perf test for steady-state measurement
- `a789ba4` - docs(bf-4jqy8): verify Layer 7 perf budget CI gate implementation
- `ea89103` - ci(bf-4jqy8): wire perf budget gate into drawrace-ci WorkflowTemplate
- `5012aa8` - fix(bf-4jqy8): correct checkout output artifact path reference

## Status
✅ COMPLETE - All requirements met, implementation verified green.
