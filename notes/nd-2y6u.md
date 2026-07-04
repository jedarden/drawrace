# nd-2y6u: WorkflowTemplate Deduplication Analysis

## Status: ✅ ALREADY COMPLETED

The work described in this bead was completed in **commit 54bf19c** on 2026-07-03.

## Summary of Findings

### Key Discovery: Files Were NOT Duplicates

The two files were **different workflows**, not copies of the same workflow:

| File | Purpose | Structure | Status |
|------|---------|-----------|--------|
| `.argo/workflow-template.yaml` | **Build workflow** (docker images, rotate keys, deploy) | Sequential `steps:` | ❌ Deleted (misnamed as CI) |
| `k8s/drawrace-ci-worktemplate.yml` | **CI workflow** (lint, test, e2e, perf) | Parallel `dag:` | ✅ Retained |

Both files had `metadata.name: drawrace-ci`, which created the appearance of duplication.

### What Was Done in Commit 54bf19c

1. **Deleted** `.argo/workflow-template.yaml` (356 lines - actually a build workflow)
2. **Added** deploy authority header comment to `k8s/drawrace-ci-worktemplate.yml`:
   ```yaml
   # Deploy authority: jedarden/declarative-config k8s/iad-ci/argo-workflows/
   # This in-repo copy must be synced to declarative-config via commit+push
   # NEVER apply this manifest directly with kubectl
   ```

### BrowserStack Secret Wiring

The `drawrace-browserstack` secret references in `device-matrix` template are **intentional** per plan.md §Testing 10.2 - they enable BrowserStack App Automate for release-candidate gating.

### Comprehensive Analysis

Full details available at: `docs/notes/workflowtemplate-deduplication-analysis.md`

---

## Acceptance Criteria Status

| Criterion | Status |
|-----------|--------|
| Document complete diff with annotations | ✅ Complete (see analysis doc) |
| Identify base file for merged version | ✅ k8s/drawrace-ci-worktemplate.yml retained |
| Output summary of what to preserve | ✅ Complete (no merge needed - different workflows) |

**Note:** No merge was required because the files were different workflows, not duplicate copies of the same workflow.

---

*Verified: 2026-07-04*
*Reference commit: 54bf19cd4f315f0db78fe3c85b5f454b04f4c6e2*
