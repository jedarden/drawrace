---
name: workflowtemplate-deduplication-complete
description: drawrace-ci WorkflowTemplate deduplication already completed
metadata:
  type: project
---

# nd-4p8p: drawrace-ci WorkflowTemplate Deduplication

## Task

Deduplicate divergent in-repo copies of the drawrace-ci WorkflowTemplate and sync with declarative-config.

## Findings

**Deduplication was already completed** — the `.argo/workflow-template.yaml` file no longer exists. The single canonical copy resides at `k8s/drawrace-ci-workflowtemplate.yml`.

### Existing State

The canonical copy already had:
- Deployment authority header (lines 1-7) documenting GitOps flow via `jedarden/declarative-config`
- BrowserStack secret wiring for device-matrix template (lines 293-302)
- Updated image tags (`ghcr.io/drawrace/ci-snap:2026-06-26`)
- Removed deprecated `synchronization.mutex` (Argo v4.0.3 removed this feature)

### Sync with declarative-config

The copy in `declarative-config` was older (image tags `2026-04-21`/`2026-04-24`). Synced the canonical copy to declarative-config via commit `95abbdc`.

## Actions Taken

1. Verified `.argo/` directory does not exist (deduplication already done)
2. Copied `k8s/drawrace-ci-workflowtemplate.yml` to `~/declarative-config/k8s/iad-ci/argo-workflows/`
3. Committed and pushed to declarative-config: `drawrace: sync WorkflowTemplate from drawrace repo` (95abbdc)
4. ArgoCD will automatically sync the updated WorkflowTemplate to the cluster

## Result

- Single canonical copy at `k8s/drawrace-ci-workflowtemplate.yml`
- Deployment authority header present
- Synced with declarative-config
- No `.argo/` directory (cleanup already done)
