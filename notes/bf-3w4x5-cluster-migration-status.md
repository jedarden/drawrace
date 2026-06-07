# Drawrace Cluster Migration Status

## Completed
- ✅ Drawrace manifests migrated from `k8s/apexalgo-iad/drawrace/` to `k8s/iad-acb/drawrace/`
- ✅ Commit `0735b57` removes apexalgo-iad configs, confirms iad-acb as target
- ✅ ApplicationSet `manifest-appset-iad-acb` includes drawrace path
- ✅ ArgoCD Application `drawrace-ns-iad-acb` managing iad-acb deployment

## Current State

### rs-manager (Ardenone Manager Cluster)
- **drawrace**: Legacy manual Application - **STUCK IN DELETION** (foregroundDeletion finalizer blocking)
- **drawrace-ns-iad-acb**: Active ApplicationSet-managed Application - Synced but Degraded (images missing)

### ardenone-manager
- **drawrace-ns-apexalgo-iad**: Should auto-prune (path `k8s/apexalgo-iad/drawrace` no longer exists)

### iad-acb (Target Cluster)
- **drawrace-ns-iad-acb**: Synced to iad-acb cluster
- Pods in ImagePullBackOff/Pending (images don't exist on Docker Hub)

## Action Required

### High Priority: Remove Legacy Application
The legacy `drawrace` Application on rs-manager has `foregroundDeletion` finalizer preventing cleanup:

```bash
# With write access to rs-manager ArgoCD:
kubectl --kubeconfig=/path/to/rs-manager.kubeconfig \
  patch application drawrace -n argocd \
  --type=json -p='[{"op": "replace", "path": "/metadata/finalizers", "value": []}]'
```

Or via ArgoCD UI: Applications → drawrace → Delete (remove finalizer checkbox)

### Root Cause: Images Don't Exist
Drawrace images `ronaldraygun/drawrace-{api,validator,live}:latest` don't exist on Docker Hub.
Build workflows are failing (test exit code 101). This is a separate issue from cluster migration.

## Cluster Determination
- **apexalgo-iad**: Read-only (CLAUDE.md) - Incorrect target
- **iad-acb**: Rackspace Spot cluster - **Correct target**

## References
- Commit: `0735b57` - "fix(bf-3w4x5): remove drawrace from apexalgo-iad, confirm iad-acb as target cluster"
- ApplicationSet: `k8s/iad-acb/iad-acb-applicationset-application.yml`
- Manifests: `k8s/iad-acb/drawrace/`
