# drawrace-ci WorkflowTemplate Audit

## Task
Audit and complete all 12 CI steps in the drawrace-ci WorkflowTemplate in declarative-config.

## Verification Results

### WorkflowTemplate Status: ✅ COMPLETE

**Location:** `~/declarative-config/k8s/iad-ci/argo-workflows/drawrace-ci-workflowtemplate.yml`
**Synced:** Yes - verified with `kubectl get workflowtemplate drawrace-ci -n argo-workflows`

### All 12 CI Steps Verified

| Step | Command | Status | Notes |
|------|---------|--------|-------|
| 1. lint | `pnpm lint` | ✅ | ESLint on engine-core/src |
| 2. unit | `pnpm vitest run --coverage` | ✅ | Requires @vitest/coverage-v8 |
| 3. physics-golden | `pnpm -F engine-core test:golden` | ✅ | Golden file regression tests |
| 4. replay-verify | `cargo test -p drawrace-validator --test replay` | ✅ | Server-side replay verification |
| 5. build | `pnpm build` | ✅ | Full build pipeline |
| 6. render-snap | `pnpm test:snapshot` | ✅ | Uses snap-step template with pinned image |
| 7. e2e | `pnpm test:e2e` | ✅ | Playwright E2E tests |
| 8. backend-contract | `pnpm test:contract` | ✅ | Backend contract tests |
| 9. perf | `pnpm test:perf` | ✅ | Performance budget tests |
| 10. phone-smoke | `bash e2e/phone-smoke/run.sh` | ✅ | Uses phone-smoke template, mutex-serialized |
| 11. load | `k6 run load/submit.js` | ✅ | Nightly only |
| 12. device-matrix | `pnpm test:devices` | ✅ | Release only, uses device-matrix template with BrowserStack |

### Templates Verified
- `step` - Generic CI step container
- `snap-step` - Pinned image for deterministic rendering
- `phone-smoke` - ADB integration with mutex serialization
- `device-matrix` - BrowserStack App Automate integration
- `push-metrics` - Metrics collection for Prometheus

### Dependencies Correctly Wired
```
lint → unit → physics-golden → build → render-snap
                  ↘ replay-verify    ↘ e2e → load (nightly)
                                       ↘ backend-contract
                                       ↘ perf
                                       ↘ phone-smoke (when preview-url)
                                       ↘ device-matrix (release)
```

### Scripts and Files Verified
- ✅ `e2e/phone-smoke/run.sh` - Phone smoke test driver
- ✅ `load/submit.js` - k6 load test script
- ✅ `scripts/push-metrics.ts` - Metrics collection script
- ✅ `playwright.browserstack.config.ts` - BrowserStack device matrix config
- ✅ `e2e/*.spec.ts` - All E2E test files

### Changes Made
Updated local repo to support CI:
1. Added `test:contract` script to package.json
2. Added `@vitest/coverage-v8` dependency for coverage reporting
3. Configured vitest coverage with proper include/exclude patterns

### Missing (Expected)
- `drawrace-browserstack` sealed-secret - This is a secret that must be created with actual BrowserStack credentials. Not checked into git.

### Conclusion
The drawrace-ci WorkflowTemplate is complete and all 12 CI steps are properly wired. The workflow is synced to the iad-ci cluster and ready for use.
