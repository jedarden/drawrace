# Layer 7 Perf Budget CI Gate Verification

## Task
Implement/perf budget CI gate: p95 ≤20ms frame time via pnpm test:perf

## Status: ✅ COMPLETE (Already Implemented)

The perf budget CI gate was already fully implemented. Verified all components:

## Implementation Details

### 1. Test Script (`e2e/perf.spec.ts`)
- Uses Chrome DevTools Protocol (CDP) for CPU throttling at 6x rate
- Enforces budgets:
  - **p95 ≤ 20ms** frame time
  - **median ≤ 12ms** frame time
  - **max frame ≤ 50ms** in steady state (after warmup)
- Includes warmup phase (120 frames / 2 seconds) to exclude JIT compilation spikes
- Writes metrics to `perf-results.json` for Prometheus collection
- Runs against `/perf-test.html` fixture

### 2. Test Fixture (`apps/web/perf-test.html`)
- Full race simulation with 4 physics sims (1 player + 3 ghosts)
- Particle system at "full" level
- Canvas rendering with 390x844 mobile viewport
- Measures 300-600 frames (5-10 seconds at 60fps)
- Computes: median, p95, max, steady-state max, average
- Trims top 2 outliers for steady-state max (GC pauses aren't frame budget issues)

### 3. Playwright Config (`playwright.config.ts`)
- `perf` project configured:
  - Desktop Chrome browser
  - Mobile viewport (390x844)
  - Matches `perf.spec.ts` test pattern

### 4. CI Integration (`k8s/drawrace-ci-workflowtemplate.yml`)
- `perf` step in CI DAG:
  - Depends on `build` step
  - Runs via `pnpm test:perf`
  - Uses `ci-snap:2026-04-21` Docker image
  - Timeout: 10 minutes
  - Resources: 500m-2 CPU, 512Mi-2Gi RAM
- Output metrics collected by `push-metrics` step for Prometheus

### 5. ArgoCD Sync Status
- Local file: `/home/coding/drawrace/k8s/drawrace-ci-workflowtemplate.yml`
- Declarative config: `/home/coding/jedarden/declarative-config/k8s/iad-ci/argo-workflows/drawrace-ci-workflowtemplate.yml`
- Both files are identical and contain the modern DAG-based CI with `perf` step
- ArgoCD app `argo-workflows` shows OutOfSync - new version pending sync
- Deployed WorkflowTemplate is 13 days old but still has `perf-budget` step running `pnpm test:perf`

## Verification

### Local Test Run
```bash
npx pnpm@10.33.1 test:perf
```

**Result:** ✅ PASSED (22.2s)

```
[1/1] [perf] › e2e/perf.spec.ts:12:3 › Layer 7: Performance Budget Tests › race frame times within budget at 6x CPU throttle
  1 passed (22.2s)
```

## Conclusion

The Layer 7 perf budget CI gate is fully implemented and wired into the drawrace-ci WorkflowTemplate. The test passes locally, confirming the implementation is correct and meeting the specified performance budgets. The deployed WorkflowTemplate is outdated and awaiting ArgoCD sync, but even the old version contains a perf-budget step that runs the same `pnpm test:perf` command.
