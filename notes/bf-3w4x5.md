---
name: bf-3w4x5
description: Resolve drawrace cluster target confusion and confirm migration to iad-acb
metadata:
  type: project
---

# BF-3W4X5: Drawrace Cluster Target Resolution

## Problem Statement
Drawrace backend was stuck in ImagePullBackOff and Pending on apexalgo-iad, which is a read-only cluster per CLAUDE.md. The task was to determine the correct cluster and ensure manifests were properly configured.

## Resolution

### Correct Cluster: iad-acb
- **Cluster:** iad-acb (https://hcp-ffb2da77-ad4e-4468-acfb-e1b3d477a8d7.spot.rackspace.com)
- **NOT apexalgo-iad** - This cluster is read-only for observability only

### Manifests Location
- **Correct location:** `k8s/iad-acb/drawrace/` in jedarden/declarative-config
- **Removed:** `k8s/apexalgo-iad/drawrace/` (incorrect cluster)

### ArgoCD Registration
- **Application:** `drawrace-ns-iad-acb` (managed by ApplicationSet `manifest-appset-iad-acb`)
- **Status:** Already properly configured and syncing to iad-acb
- **Manual app:** `k8s/rs-manager/drawrace-application.yml` removed (superseded by ApplicationSet)

### Git History Context
Drawrace was mistakenly migrated TO apexalgo-iad in commit b913065 ("feat(drawrace): migrate from iad-acb to apexalgo-iad"). This was an error since apexalgo-iad is read-only. The correct target has always been iad-acb.

### Commit Changes
- Removed: k8s/apexalgo-iad/drawrace/ (10 files, 553 deletions)
- Disabled: k8s/iad-acb/drawrace/live-deployment.yaml (not currently in use)
- Removed: k8s/rs-manager/drawrace-application.yml (manual app superseded by ApplicationSet)
- Added: k8s/rs-manager/drawrace-application.yml.disabled (documents migration history)

## Current Deployment Status on iad-acb
The deployment is syncing but has degraded health due to:
1. **ExternalSecrets failing:** `drawrace-postgres-credentials`, `drawrace-api-s3-credentials`, `drawrace-postgres-backup-s3` - These need to be created in OpenBao at the referenced KV paths
2. **ImagePullBackOff:** Images are failing to pull (docker-hub-registry secret synced successfully, but images may not exist or require different auth)

## Unblocked Tasks
bf-47rz, bf-1uzl, bf-1x5r, bf-3ixf, bf-3ljs, bf-20k7

## Next Steps (Separate Tasks)
1. Create OpenBao secrets at required paths (rs-manager/drawrace/*)
2. Verify Docker Hub images exist and are accessible
3. Clean up stale drawrace resources on apexalgo-iad (manual kubectl delete since ArgoCD won't touch read-only cluster)
