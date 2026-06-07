# Drawrace Cluster Resolution Summary

**Date:** 2025-01-07  
**Bead:** bf-3w4x5

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
