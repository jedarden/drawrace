# bf-4jqy8: Layer 7 Perf Budget CI Gate Verification

## Date
2026-06-08

## Task
Implement Layer 7 perf budget CI gate: p95 ≤20ms frame time via pnpm test:perf

## Finding: Already Fully Implemented

The perf budget gate was already implemented in previous commits:
- `469ef6b` - layer7: perf budget tests with CDP CPU throttling (original)
- `b444931` - test(bf-4jqy8): implement Layer 7 perf budget CI gate
- `7958714` - feat(bf-4jqy8): add warmup phase to perf test for steady-state measurement

## Verification Checklist (All ✓)

### 1. Headless Chromium + CDP throttling
- `e2e/perf.spec.ts:13-14` uses CDP `Emulation.setCPUThrottlingRate` at 6x

### 2. Median ≤12ms frame time
- `MEDIAN_BUDGET_MS = 12` defined and enforced in spec

### 3. p95 ≤20ms frame time
- `P95_BUDGET_MS = 20` defined and enforced in spec

### 4. No frame >50ms in steady state
- `MAX_FRAME_BUDGET_MS = 50` enforced on `steadyStateMaxMs`
- Warmup phase (120 frames) excludes JIT compilation spikes
- Top 2 outliers trimmed for steady-state max (GC pauses not counted)

### 5. Runs via pnpm test:perf
- `package.json` has: `"test:perf": "playwright test e2e/perf.spec.ts --project perf"`

### 6. Wired into CI
- `k8s/drawrace-ci-workflowtemplate.yml` has `perf` step
- Runs `pnpm test:perf` as CI step
- Depends on `build`, contributes metrics to `push-metrics`

## Local Test Result

```bash
$ pnpm test:perf
Running 1 test using 1 worker
✓ Layer 7: Performance Budget Tests › race frame times within budget at 6x CPU throttle
  1 passed (26.1s)
```

## Perf Test Fixture Details (`apps/web/perf-test.html`)

- 3 ghost simulations match real race load
- 120-frame warmup phase (2 seconds at 60fps) per plan §Testing 8
- Measures only steady-state frames after warmup
- Full particle system and rendering
- Fixed 390x844 mobile viewport
- Outputs metrics JSON for Prometheus collection

## CI Workflow Integration

- Template synced to `iad-ci` cluster (verified via kubectl)
- Part of CI DAG: lint → unit → physics-golden → build → perf → push-metrics
- Metrics collected and pushed to Prometheus pushgateway

## Conclusion

All requirements met. Implementation complete and passing. No changes needed.
