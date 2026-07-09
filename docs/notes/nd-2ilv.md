---
title: Task nd-2ilv - Delete obsolete .argo/workflow-template.yaml
date: 2026-07-04
---

## Task

Delete obsolete `.argo/workflow-template.yaml` file after canonical copy was created at `k8s/drawrace-ci-workflowtemplate.yml`.

## Outcome

**Already completed in commit `54bf19c` on July 3, 2026.**

The commit `54bf19cd4f315f0db78fe3c85b5f454b04f4c6e2` already handled this:

```
 .argo/workflow-template.yaml         | 356 -----------------------------------
 docs/plan/plan.md                    |   4 +-
 k8s/drawrace-ci-workflowtemplate.yml |   7 +
 3 files changed, 9 insertions(+), 358 deletions(-)
```

## Acceptance criteria (all met)

- ✅ `.argo/workflow-template.yaml` is deleted (done in 54bf19c)
- ✅ `.argo/` directory removed after deletion (confirmed: directory no longer exists)
- ✅ No other references to `.argo/workflow-template.yaml` exist in the repo (only historical documentation in notes/nd-4mf5.md and notes/nd-2y6u.md)

## Related beads

- nd-4p8p: Genesis bead for drawrace-ci migration
- nd-4mf5: Found the canonical workflowtemplate location
- nd-2y6u: Previously documented the workflowtemplate deduplication
