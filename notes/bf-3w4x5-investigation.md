# Drawrace Cluster Migration Investigation - bf-3w4x5

## Problem Statement

Backend stuck in ImagePullBackOff and Pending on apexalgo-iad (read-only cluster). Plan targets iad-acb.

## Current State

### 1. Manifests Status ✅
- Manifests already exist at `k8s/iad-acb/drawrace/` in declarative-config
- ApplicationSet already includes the drawrace path
- No additional manifests need to be created

### 2. ArgoCD Applications Conflict ⚠️

Two ArgoCD applications managing the same resources:

| App | Source | Project | Sync | Health | Status |
|-----|--------|---------|------|--------|--------|
| `drawrace` | k8s/iad-acb/drawrace | default | OutOfSync | Degraded | **STUCK IN DELETION** |
| `drawrace-ns-iad-acb` | k8s/iad-acb/drawrace (auto-generated) | spot | Synced | Degraded | Active |

### 3. Blocker Details

The `drawrace` application:
- Has `deletionTimestamp: 2026-06-07T18:33:34Z`
- Stuck with `foregroundDeletion` finalizer
- Cannot complete deletion because all 30 resources are also managed by `drawrace-ns-iad-acb`
- Resources show `SharedResourceWarning` for all managed resources

### 4. Degraded Resources on drawrace-ns-iad-acb

ExternalSecrets are failing to fetch from provider (OpenBao):
- `ExternalSecret/drawrace-api-s3-credentials`: could not get secret data from provider
- `ExternalSecret/drawrace-postgres-backup-s3`: could not get secret data from provider
- `ExternalSecret/drawrace-postgres-credentials`: could not get secret data from provider

## Required Actions

### Action 1: Delete Stuck drawrace Application

The `drawrace` application needs to be removed to resolve the conflict. Options:

**Option A: Via ArgoCD UI** (Preferred if available)
1. Access https://argocd-rs-manager.tail1b1987.ts.net:8080
2. Navigate to Applications → drawrace
3. Delete the application

**Option B: Via kubectl with kubeconfig**
```bash
export KUBECONFIG=/home/coding/.kube/rs-manager.kubeconfig
# Remove finalizer to force deletion
kubectl patch application drawrace -n argocd -p '{"metadata":{"finalizers":[]}}' --type=merge
# Or just delete (should complete immediately after finalizer removal)
kubectl delete application drawrace -n argocd --force --grace-period=0
```

**Option C: Via kubectl-proxy** (Limited - may not work due to read-only)
The proxy at `http://traefik-rs-manager:8001` is read-only per CLAUDE.md.

### Action 2: Fix ExternalSecrets

After drawrace app is deleted and drawrace-ns-iad-acb is the sole manager:
1. Access OpenBao on rs-manager
2. Create required secrets:
   - `secret/rs-manager/drawrace/s3-credentials`
   - `secret/rs-manager/drawrace/postgres-backup-s3`
   - `secret/rs-manager/drawrace/postgres-credentials`
3. Verify ExternalSecrets sync successfully

## Missing Infrastructure

- **File**: `/home/coding/.kube/rs-manager.kubeconfig`
- **Status**: Does not exist
- **Instructions**: Regenerate from Rackspace Spot UI per `/home/coding/declarative-config/k8s/rs-manager/CLAUDE.md`

## Cluster Mappings

| Cluster Name | Server URL | Purpose |
|--------------|------------|---------|
| apexalgo-iad | https://hcp-99476ebb-4133-4a21-ac6a-6e2bdf6794c0.spot.rackspace.com | Production (read-only proxy) |
| iad-acb | https://hcp-ffb2da77-ad4e-4468-acfb-e1b3d477a8d7.spot.rackspace.com | **TARGET CLUSTER** |
| rs-manager | https://kubernetes.default.svc | Management cluster (runs ArgoCD for iad-* clusters) |

## Next Steps

1. User provides rs-manager.kubeconfig OR deletes drawrace app via ArgoCD UI
2. Verify drawrace app is gone
3. Verify drawrace-ns-iad-acb transitions to Healthy
4. Verify pods on iad-acb come up successfully
