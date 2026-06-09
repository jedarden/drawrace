# drawrace-ci WorkflowTemplate Audit

## Summary

Audited the drawrace-ci WorkflowTemplate in `jedarden/declarative-config` and verified all 12 CI steps are correctly wired and functional.

## Findings

### Template Location
- **File:** `~/declarative-config/k8s/iad-ci/argo-workflows/drawrace-ci-workflowtemplate.yml`
- **Cluster:** Synced to `iad-ci` cluster, `argo-workflows` namespace
- **Status:** ✅ Template exists and is up-to-date on cluster

### All 12 Steps Verified

| Step | Command | Script Exists | Status |
|------|---------|---------------|--------|
| lint | `pnpm lint` | `package.json` → eslint | ✅ |
| unit | `pnpm vitest run --coverage` | `vitest.config.ts` + `@vitest/coverage-v8` | ✅ |
| physics-golden | `pnpm -F engine-core test:golden` | `packages/engine-core/package.json` | ✅ |
| replay-verify | `cargo test -p drawrace-validator --test replay` | `crates/validator/tests/replay.rs` | ✅ |
| build | `pnpm build` | `package.json` | ✅ |
| render-snap | `pnpm test:snapshot` | `package.json` | ✅ |
| e2e | `pnpm test:e2e` | `package.json` | ✅ |
| backend-contract | `pnpm test:contract` | `package.json` → `cargo test -p drawrace-validator` | ✅ |
| perf | `pnpm test:perf` | `package.json` | ✅ |
| phone-smoke | `bash e2e/phone-smoke/run.sh` | `e2e/phone-smoke/run.sh` | ✅ |
| load | `k6 run load/submit.js` | `load/submit.js` | ✅ |
| device-matrix | `pnpm test:devices` | `package.json` | ✅ |

### Additional Components Verified

- **Metrics push:** `scripts/push-metrics.ts` exists and is wired in the DAG
- **Phone smoke mutex:** Configured with `drawrace-phone` mutex for serialization
- **Device matrix secrets:** References `drawrace-browserstack` secret for BrowserStack credentials
- **Conditional execution:** `phone-smoke` runs when preview-url is non-empty; `load` runs on nightly mode; `device-matrix` runs on release mode

### CI Images Used
- `ghcr.io/drawrace/ci-snap:2026-04-21` - Main CI image
- `ghcr.io/drawrace/ci-snap:2026-04-24` - Snapshot rendering (pinned for determinism)
- `ghcr.io/drawrace/ci-phone:2026-04-21` - Phone smoke tests

## Conclusion

The drawrace-ci WorkflowTemplate is **complete** with all 12 steps properly wired and all referenced scripts/tests existing in the drawrace repository. The template is synced to the cluster and ready for use.

No changes were required — the audit confirmed the template matches the specification in `docs/plan.md §Testing 11`.
