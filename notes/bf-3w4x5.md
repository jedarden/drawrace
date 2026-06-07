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

## Current Deployment Status on iad-acb (Verified 2026-06-07)

### Application Status
- **ApplicationSet `manifest-appset-iad-acb`**: Active and healthy on rs-manager
- **Application `drawrace-ns-iad-acb`**: **Synced** but **Degraded**
- **Old Application `drawrace`**: Deleting (has `deletionTimestamp: 2026-06-07T18:33:34Z`)

### Health Status
The deployment is architecturally correct but Degraded due to:
1. **ExternalSecrets failing:** `drawrace-postgres-credentials`, `drawrace-api-s3-credentials`, `drawrace-postgres-backup-s3`
   - Need OpenBao secrets at paths:
     - `secret/rs-manager/drawrace/postgres` (username, password)
     - `secret/rs-manager/drawrace/postgres-backup` (accessKeyId, secretAccessKey)
     - `secret/rs-manager/drawrace/s3` (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_ENDPOINT_URL, AWS_REGION)
2. **Deployments stuck:** drawrace-api, drawrace-live, drawrace-postgres, drawrace-validator are Degraded
   - "exceeded its progress deadline" - waiting on ExternalSecrets

### What's Working
- ✅ ArgoCD sync: Manifests are being applied correctly
- ✅ redis deployment: Healthy
- ✅ docker-hub-registry ExternalSecret: Healthy (syncing from ardenone-hub)
- ✅ Ingress, NetworkPolicy, Services: Synced and healthy

### What's Blocking
- ❌ 3 ExternalSecrets: Degraded (missing OpenBao secrets)
- ❌ 4 Deployments: Degraded (blocked by missing secrets)

## Unblocked Tasks
bf-47rz, bf-1uzl, bf-1x5r, bf-3ixf, bf-3ljs, bf-20k7

## Next Steps (Separate Tasks)

To complete the drawrace deployment on iad-acb:

1. **Create OpenBao secrets** (rs-manager/drawrace/*):
   - postgres (username, password)
   - postgres-backup (accessKeyId, secretAccessKey)
   - s3 (AWS credentials and endpoint)

2. **Monitor ExternalSecrets**: Once secrets are created, verify ExternalSecrets become Healthy

3. **Verify deployments**: Check that drawrace-api, drawrace-live, drawrace-postgres, drawrace-validator scale up successfully

4. **Clean up apexalgo-iad** (optional): Remove stale drawrace resources from read-only cluster (manual kubectl delete)
