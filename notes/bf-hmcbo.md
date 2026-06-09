# BF-HMCBO: Argo Events sensor for drawrace repo webhook

## Task
Configure the Argo Events sensor in declarative-config to trigger drawrace-build Workflow on pushes to any branch.

## Work Completed
The sensor file `drawrace-sensor.yml` already existed in `~/declarative-config/k8s/iad-ci/argo-events/`, but was incorrectly configured:

**Original issues:**
1. Only triggered on `refs/heads/main` branch, not "any branch"
2. Passed hardcoded `branch: main` parameter to the workflow

**Fixes applied:**
1. Changed branch filter from `refs/heads/main` to regex `^refs/heads/.*` (any branch)
2. Changed branch parameter to dynamic value: `{{ split .Input.body.ref '/' | last }}`
   - Extracts branch name from GitHub webhook's `refs/heads/branch-name` format

**File modified:** `~/declarative-config/k8s/iad-ci/argo-events/drawrace-sensor.yml`

## Commit
- Repo: jedarden/declarative-config
- Commit: `4eb135b` - "fix(drawrace-sensor): trigger on any branch and pass branch dynamically"

## Result
CI builds now automatically trigger on pushes to any branch in the drawrace repo, with the correct branch being built by the drawrace-build WorkflowTemplate.
