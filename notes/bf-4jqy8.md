# bf-4jqy8: Layer 7 Perf Budget CI Gate

## Date
2026-06-08

## Task
Implement Layer 7 perf budget CI gate: p95 ≤20ms frame time via pnpm test:perf

## Status: COMPLETE

All requirements were already implemented in previous commits:
- `469ef6b` - Original perf budget tests with CDP throttling
- `b444931` - CI gate implementation
- `7958714` - Warmup phase for steady-state measurement

## Implementation Summary

### Perf Test (`e2e/perf.spec.ts`)
- Uses CDP `Emulation.setCPUThrottlingRate` at 6x CPU throttle
- Enforces median ≤12ms, p95 ≤20ms, steady-state max ≤50ms
- Requires minimum 300 frames for statistical validity
- Outputs metrics JSON for Prometheus collection

### Perf Test Fixture (`apps/web/perf-test.html`)
- 3 ghost simulations matching real race load
- 120-frame warmup phase (2 seconds at 60fps) to exclude JIT spikes
- Full particle system and rendering
- Fixed 390x844 mobile viewport

### CI Integration (`k8s/drawrace-ci-workflowtemplate.yml`)
- Perf step runs `pnpm test:perf`
- Depends on `build` step
- Contributes metrics to `push-metrics` step
- Workflow synced to iad-ci cluster

### Configuration
- `package.json`: `"test:perf": "playwright test e2e/perf.spec.ts --project perf"`
- `playwright.config.ts`: `perf` project with mobile viewport

## Verification

```bash
$ pnpm test:perf
Running 1 test using 1 worker
✓ Layer 7: Performance Budget Tests › race frame times within budget at 6x CPU throttle
  1 passed (31.3s)
```

All requirements met. Implementation complete and passing.
