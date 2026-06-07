# Drawrace Cluster Resolution - Current Status

## What Was Done

### Analysis Complete ✅
- Confirmed target cluster: **iad-acb** (Rackspace Spot cluster managed by rs-manager)
- Confirmed manifests exist in correct location: `k8s/iad-acb/drawrace/`
- Confirmed ApplicationSet is registered: `manifest-appset-iad-acb` creates `drawrace-ns-iad-acb`

### Root Cause Identified ✅
**Two ArgoCD applications are managing the same resources:**

1. `drawrace-ns-iad-acb` (ApplicationSet-managed) - CORRECT ✅
   - Created by `manifest-appset-iad-acb` ApplicationSet
   - Source: `k8s/iad-acb/drawrace`
   - Destination: iad-acb cluster
   - Status: OutOfSync, Degraded (due to resource conflict)

2. `drawrace` (standalone) - CONFLICTING ❌
   - Same source and destination
   - Status: OutOfSync, Degraded
   - Problem: Fights with `drawrace-ns-iad-acb` for control of resources

## Why This Blocks Deployment

Both applications try to manage the same 30 resources (deployments, services, secrets, etc.). ArgoCD refuses to sync when multiple applications claim ownership, causing:
- ImagePullBackOff on pods
- Permanent OutOfSync/Degraded status
- No automated healing from the ApplicationSet

## Resolution Required

**Delete the standalone `drawrace` application** so `drawrace-ns-iad-acb` can manage resources without conflict.

## Current Blocker

❌ **No rs-manager.kubeconfig available**

The kubeconfig at `/home/coding/.kube/rs-manager.kubeconfig` is missing. According to CLAUDE.md, this kubeconfig:
- Provides cluster-admin access to rs-manager
- Expires every ~3 days and needs regeneration from Rackspace Spot UI
- Is required for ArgoCD Application management

## How to Unblock

### Option 1: Regenerate kubeconfig (preferred)
1. Log into Rackspace Spot UI
2. Navigate to rs-manager cluster
3. Download kubeconfig
4. Save to `/home/coding/.kube/rs-manager.kubeconfig`

### Option 2: Use ArgoCD UI
Access https://argocd-rs-manager.tail1b1987.ts.net:8080 and delete the `drawrace` application manually.

### Option 3: Provide existing kubeconfig
If you have the kubeconfig regenerated or stored elsewhere, provide it and the task continues automatically.

## After Unblocking

Once the conflicting application is deleted:
1. `drawrace-ns-iad-acb` will automatically sync
2. All resources should become Healthy
3. Deployments will pull images correctly
4. Unblocks: bf-47rz, bf-1uzl, bf-1x5r, bf-3ixf, bf-3ljs, bf-20k7

---

**Timestamp:** 2025-06-07T18:30:00Z
**Status:** BLOCKED - Waiting for rs-manager.kubeconfig
