# WorkflowTemplate Sync nd-1aqz

**Date:** 2026-07-04

## Task
Verify and sync drawrace-ci WorkflowTemplate with declarative-config

## Findings
The canonical version in drawrace repo (`k8s/drawrace-ci-workflowtemplate.yml`) was **newer** than the deployed version in declarative-config.

### Key differences (canonical → declarative-config):
1. **Deployment authority header added** - Critical GitOps documentation at the top of the file
2. **CI images updated** - `ci-snap:2026-06-26` (canonical) vs `ci-snap:2026-04-21/2026-04-24` (declarative-config)
3. **Phone-smoke mutex removed** - Argo v4.0.3 removed `synchronization.mutex`; canonical version reflects this with updated comment and removed mutex block

## Action Taken
- Committed and pushed the canonical version to `jedarden/declarative-config` repo
- Commit: `2217c67` "sync: drawrace-ci WorkflowTemplate from drawrace repo"
- ArgoCD will automatically sync the update to the cluster

## Verification
Both copies are now identical (verified with diff).
