# WorkflowTemplate Deduplication Analysis

## Executive Summary

**Status:** ✅ **ALREADY COMPLETED** - The deduplication described in bead nd-4p8p was executed in commit 54bf19c on 2026-07-03.

**Finding:** The task description was based on outdated information. Only ONE copy of `drawrace-ci` WorkflowTemplate now exists, and the deduplication work has been completed correctly.

---

## Background: What the Task Described

Bead nd-4p8p stated:

> The repo carries TWO different copies of the same WorkflowTemplate 'drawrace-ci':
> - .argo/workflow-template.yaml (356 lines)
> - k8s/drawrace-ci-workflowtemplate.yml (402 lines, includes drawrace-browserstack secret wiring)

The bead claimed these were "divergent copies of the same WorkflowTemplate" that needed merging.

---

## Investigation Results

### Finding 1: Only One File Exists Now

As of 2026-07-03, **only one file exists**:
- ✅ `k8s/drawrace-ci-workflowtemplate.yml` (409 lines)

The `.argo/workflow-template.yaml` file does **not exist** - the `.argo/` directory itself has been removed.

### Finding 2: The Files Were NOT Duplicates

Critical discovery: The two files were **NOT copies of the same workflow**. They were **two different workflows** that happened to share the same `metadata.name: drawrace-ci`.

#### `.argo/workflow-template.yaml` (deleted)

This was actually a **BUILD workflow** that performed:
- Docker image builds for api and validator
- `rotate-client-key` ConfigMap rotation
- `update-declarative-config` manifest updates
- `wait-validator-live` health checks
- `wrangler-pages` deployment

**Structure:** Sequential `steps:` with artifact passing between templates.

**Purpose:** Identical to what `drawrace-build` WorkflowTemplate does today.

#### `k8s/drawrace-ci-workflowtemplate.yml` (current)

This is the actual **CI workflow** that performs:
- Unit tests (vitest)
- Physics golden tests
- Replay verification
- Build steps
- E2E tests
- Perf budget checks
- Phone smoke tests
- Device matrix tests
- Load/chaos tests (nightly/release modes)

**Structure:** Parallel `dag:` with dependencies.

**Purpose:** Test coverage and quality gates, not deployment.

### Finding 3: The Deletion Was Correct

Commit 54bf19c ("docs: consistent repo-relative paths") on 2026-07-03:

```diff
 .argo/workflow-template.yaml         | 356 -----------------------------------
 k8s/drawrace-ci-workflowtemplate.yml |   7 +
```

The commit:
1. **Deleted** `.argo/workflow-template.yaml` (the misnamed build workflow)
2. **Added** a header comment to `k8s/drawrace-ci-workflowtemplate.yml` establishing deploy authority

**What was added to k8s/drawrace-ci-workflowtemplate.yml:**

```yaml
+# ────────────────────────────────────────────────────────────────────────────────
+# Deploy authority: jedarden/declarative-config k8s/iad-ci/argo-workflows/
+#
+# This in-repo copy must be synced to declarative-config via commit+push on the
+# drawrace repo, then ArgoCD will automatically sync it to the cluster. NEVER apply
+# this manifest directly with kubectl — all cluster changes go through GitOps.
+# ────────────────────────────────────────────────────────────────────────────────
```

This header comment **exactly matches** the acceptance criteria from bead nd-4p8p:

> Add a header comment to the retained file stating that the deploy authority is jedarden/declarative-config k8s/iad-ci/argo-workflows/ and the in-repo copy must be synced there via commit+push (never kubectl apply directly).

### Finding 4: No drawrace-browserstack Secret in Current File

The task description mentioned "k8s/drawrace-ci-workflowtemplate.yml (402 lines, includes drawrace-browserstack secret wiring)".

**Investigation:** The current `k8s/drawrace-ci-workflowtemplate.yml` **does** include BrowserStack integration in the `device-matrix` template (lines 270-327):

```yaml
- name: device-matrix
  # ...
  env:
    # BrowserStack credentials injected from sealed-secret
    - name: BROWSERSTACK_USERNAME
      valueFrom:
        secretKeyRef:
          name: drawrace-browserstack
          key: username
    - name: BROWSERSTACK_ACCESS_KEY
      valueFrom:
        secretKeyRef:
          name: drawrace-browserstack
          key: access-key
```

This is **intentional and correct** - the device-matrix step runs on BrowserStack App Automate during release mode.

---

## Differences Between the Two Files (Historical)

Since the `.argo/workflow-template.yaml` file was actually a different workflow, comparing them is like comparing apples to oranges. However, here are the key structural differences:

### Parameter Names

| Purpose | `.argo/` version | `k8s/` version |
|---------|------------------|----------------|
| Branch | `branch` | `ref` |
| Repo | `repo` (Forgejo URL) | Not in CI workflow |
| Republish mode | `republish_only` | Not in CI workflow |
| Test mode | Not in build workflow | `mode` (pr/nightly/release) |
| Preview URL | Not in build workflow | `preview-url` |

### Structure

- **`.argo/` version:** Linear `steps:` sequence with artifact passing
- **`k8s/` version:** Parallel `dag:` with dependency management

### Content

The `.argo/` version was essentially a **duplicate of drawrace-build functionality**:
- checkout → rotate-key → build images → bump manifests → wait-for-validator → deploy

The `k8s/` version is the **actual CI workflow** described in plan.md §Testing 11:
- lint → unit → physics-golden → replay-verify → build → e2e → perf → phone-smoke → device-matrix → load/chaos

---

## Current State Assessment

### ✅ Correct: Single Canonical Location

The `drawrace-ci` WorkflowTemplate now exists **only** at:
```
k8s/drawrace-ci-workflowtemplate.yml
```

This matches the sibling `drawrace-build-workflowtemplate.yml` location pattern.

### ✅ Correct: Deploy Authority Header

The file has the required header comment establishing GitOps authority.

### ✅ Correct: BrowserStack Integration

The `drawrace-browserstack` secret reference in the `device-matrix` template is **intentional** and matches the design in plan.md §Testing 10.2 (BrowserStack App Automate for release gating).

### ✅ Correct: Workflow Structure

The current workflow matches the plan.md §Testing 11 specification:
- DAG-based parallelism
- Mode-gated steps (nightly: load/chaos, release: device-matrix)
- Mutex-serialized phone-smoke (when preview URL available)
- Metrics collection step

---

## Recommendation

**No further action required.** The deduplication work described in bead nd-4p8p has been completed correctly.

### For Bead Closure

Bead nd-4p8p should be closed with the following summary:

> **Completed by commit 54bf19c (2026-07-03)**. The `.argo/workflow-template.yaml` file (which was actually a misnamed build workflow, not a CI workflow) was deleted. The canonical `drawrace-ci` WorkflowTemplate now exists only at `k8s/drawrace-ci-workflowtemplate.yml` with the required deploy authority header comment. The BrowserStack secret wiring in the device-matrix template is intentional per plan.md §Testing 10.2. No merge was needed because the files were different workflows, not duplicate copies.

---

## Historical Context

### Why Two Files Existed

The `.argo/workflow-template.yaml` file was created in commit 0d81e86 (2026-04-22) as part of Phase 4 completion. It was likely intended to be the `drawrace-build` WorkflowTemplate but was incorrectly named `drawrace-ci`.

The correct `drawrace-build` WorkflowTemplate already existed at `k8s/drawrace-build-workflowtemplate.yml`, leaving two build workflows with different names, and one misnamed file in `.argo/`.

### Why the Confusion Persisted

Both files had `metadata.name: drawrace-ci`, which made them appear to be duplicates of the same workflow. Only by examining the actual workflow structure (steps vs dag, templates, purpose) does it become clear they were different workflows serving different purposes.

---

## Appendix: File Line Counts

| File | Lines | Status |
|------|-------|--------|
| `.argo/workflow-template.yaml` | 356 | ❌ Deleted (was build workflow, not CI) |
| `k8s/drawrace-ci-workflowtemplate.yml` | 409 → 409 | ✅ Retained (actual CI workflow) |
| `k8s/drawrace-build-workflowtemplate.yml` | 706 | ✅ Unrelated (build workflow) |

---

## Verification Steps Completed

1. ✅ Confirmed `.argo/workflow-template.yaml` does not exist
2. ✅ Confirmed `.argo/` directory does not exist
3. ✅ Retrieved deleted file from git history for analysis
4. ✅ Compared deleted file with current k8s version
5. ✅ Identified that files were different workflows, not duplicates
6. ✅ Verified current file has required header comment
7. ✅ Verified BrowserStack integration is intentional
8. ✅ Confirmed current state matches all acceptance criteria

---

*Analysis performed: 2026-07-03*
*Commit reference: 54bf19cd4f315f0db78fe3c85b5f454b04f4c6e2*
