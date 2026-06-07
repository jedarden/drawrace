# Drawrace Cluster Resolution Summary

**Date:** 2026-06-07
**Bead:** bf-3w4x5
**Status:** VERIFIED - Infrastructure in place

## Executive Summary

Drawrace cluster target is **iad-acb** (Rackspace Spot cluster). The manifests and ArgoCD Application are already in place via ApplicationSet. The deployment is currently Degraded due to missing OpenBao secrets.

## Current State

### Target Cluster: iad-acb

**Cluster URL:** `https://hcp-ffb2da77-ad4e-4468-acfb-e1b3d477a8d7.spot.rackspace.com`

**Manifests Location:** `jedarden/declarative-config/k8s/iad-acb/drawrace/`

**ArgoCD Application:** `drawrace-ns-iad-acb` (managed by `manifest-appset-iad-acb` ApplicationSet)

**Status:** Synced but Degraded

### Source Cluster: apexalgo-iad (DEPRECATED)

**Status:** Read-only (per CLAUDE.md)

**Current Deployment State:**
- Pods stuck in ImagePullBackOff and Pending
- Deployments: `drawrace-api` (0/2), `drawrace-validator` (0/1)
- No drawrace manifests in declarative-config for this cluster

### Resources on iad-acb

| Resource | Health | Notes |
|----------|--------|-------|
| drawrace-api Deployment | Degraded | Waiting for secrets |
| drawrace-live Deployment | Degraded | Waiting for secrets |
| drawrace-postgres Deployment | Degraded | Waiting for secrets |
| drawrace-validator Deployment | Degraded | Waiting for secrets |
| redis Deployment | Healthy | |
| drawrace-api-s3-credentials ExternalSecret | Degraded | Missing OpenBao secret |
| drawrace-postgres-backup-s3 ExternalSecret | Degraded | Missing OpenBao secret |
| drawrace-postgres-credentials ExternalSecret | Degraded | Missing OpenBao secret |
| docker-hub-registry ExternalSecret | Healthy | Syncing from ardenone-hub |

## Blockers

The deployment is Degraded because the following OpenBao secrets do not exist:

1. **rs-manager/drawrace/postgres** (keys: username, password)
2. **rs-manager/drawrace/postgres-backup** (keys: accessKeyId, secretAccessKey)
3. **rs-manager/drawrace/s3** (keys: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_ENDPOINT_URL, AWS_REGION)

These secrets need to be created in OpenBao on rs-manager before the deployments can become Healthy.

## Completed Work

1. ✅ **Cluster Target Determined:** iad-acb is the correct target cluster
2. ✅ **Manifests Created:** All manifests exist at `k8s/iad-acb/drawrace/`
3. ✅ **ArgoCD Application Registered:** Managed by ApplicationSet `manifest-appset-iad-acb`
4. ✅ **External-Secrets Operator:** Healthy and configured with ClusterSecretStore `openbao`

### Verification (2026-06-07)

All infrastructure verified to be in place:

- **ApplicationSet `manifest-appset-iad-acb`**: Exists and active on rs-manager
  - Creates `drawrace-ns-iad-acb` Application from `k8s/iad-acb/drawrace/` manifests
  - Owner reference confirms it is ApplicationSet-managed

- **Application `drawrace-ns-iad-acb`**: Synced but Degraded
  - Synced: Manifests are being applied correctly
  - Degraded: Missing OpenBao secrets (expected blocker)

- **Old Application `drawrace`**: Being deleted
  - Has `deletionTimestamp: "2026-06-07T18:33:34Z"`
  - Finalizer `foregroundDeletion` causing gradual cleanup
  - Conflicts with ApplicationSet-managed resources (SharedResourceWarning conditions)
  - Once deleted, only `drawrace-ns-iad-acb` will remain

- **Manifests Directory**: `k8s/iad-acb/drawrace/`
  - Contains 17 YAML files including deployments, services, ingress, external-secrets
  - All manifests synced to cluster via ArgoCD

## Verification Status (2026-06-07)

**Infrastructure**: ✅ Complete
- Cluster target: iad-acb (https://hcp-ffb2da77-ad4e-4468-acfb-e1b3d477a8d7.spot.rackspace.com)
- Manifests: k8s/iad-acb/drawrace/ in declarative-config repo
- ApplicationSet: manifest-appset-iad-acb (creates drawrace-ns-iad-acb)
- Application: drawrace-ns-iad-acb (Synced, Degraded due to missing secrets)
- Old application: drawrace (deleting, blocked by finalizer)

**Deployment Blocker**: Missing OpenBao secrets
- rs-manager/drawrace/postgres
- rs-manager/drawrace/postgres-backup  
- rs-manager/drawrace/s3

Once secrets are created, deployments will transition from Degraded to Healthy.

## Next Steps

1. Create OpenBao secrets at paths:
   - `secret/rs-manager/drawrace/postgres`
   - `secret/rs-manager/drawrace/postgres-backup`
   - `secret/rs-manager/drawrace/s3`

2. Verify ExternalSecrets become Healthy

3. Verify Deployments transition from Degraded to Healthy

4. Clean up apexalgo-iad drawrace deployments (optional, cluster is read-only)

## Cluster Access

- **iad-acb:** Managed via rs-manager ArgoCD (no direct kubectl-proxy)
- **apexalgo-iad:** Read-only via kubectl-proxy at `http://traefik-apexalgo-iad:8001`

## Related Beads

Unblocked by this resolution:
- bf-47rz
- bf-1uzl
- bf-1x5r
- bf-3ixf
- bf-3ljs
- bf-20k7
