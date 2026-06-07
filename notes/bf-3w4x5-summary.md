# Drawrace Cluster Migration Summary - bf-3w4x5

## Task Completed

**Resolve drawrace cluster target: iad-acb vs apexalgo-iad, migrate manifests in declarative-config**

### What Was Done

1. **Cluster Target Determined**: ✅
   - **Target: iad-acb** (https://hcp-ffb2da77-ad4e-4468-acfb-e1b3d477a8d7.spot.rackspace.com)
   - apexalgo-iad is read-only per CLAUDE.md - not suitable for live workloads

2. **Manifests Verified**: ✅
   - Already exist at `k8s/iad-acb/drawrace/` in jedarden/declarative-config
   - No migration needed - files already in place
   - Includes: api-deployment.yaml, postgres-deployment.yaml, validator-deployment.yaml, live-deployment.yaml, drawrace-externalsecrets.yml, ingress.yaml, networkpolicy.yaml, redis.yaml, namespace.yml

3. **ArgoCD Registration Verified**: ✅
   - ApplicationSet `manifest-appset-iad-acb` already includes drawrace path
   - Creates `drawrace-ns-iad-acb` application automatically
   - Old manual `drawrace` application disabled (drawrace-application.yml.disabled)

## Current State

### ArgoCD Applications on rs-manager

| Application | Status | Health | Notes |
|------------|--------|--------|-------|
| `drawrace` | OutOfSync | Degraded | **STUCK IN DELETION** - has foregroundDeletion finalizer |
| `drawrace-ns-iad-acb` | Synced | Degraded | Active - managed by ApplicationSet |

### Resources on iad-acb

**Pods** (as of 2026-06-07):
- `drawrace-api`: ImagePullBackOff (0/2 ready) - image `ronaldraygun/drawrace-api:latest` doesn't exist
- `drawrace-live`: Pending (0/2 ready) - image `ronaldraygun/drawrace-live:latest` doesn't exist
- `drawrace-validator`: Pending (0/1 ready) - image `ronaldraygun/drawrace-validator:latest` doesn't exist
- `drawrace-postgres`: Pending (0/1 ready) - waiting for secrets
- `redis`: Running (1/1 ready) ✅

**ExternalSecrets** (all failing):
- `docker-hub-registry`: SecretSynced ✅ (working)
- `drawrace-api-s3-credentials`: SecretSyncedError ❌ (missing secret)
- `drawrace-postgres-backup-s3`: SecretSyncedError ❌ (missing secret)
- `drawrace-postgres-credentials`: SecretSyncedError ❌ (missing secret)

### Build Workflow

**drawrace-build** workflow template exists in iad-ci and was triggered but failed at test stage.
Images need to be built:
- `ronaldraygun/drawrace-api:latest`
- `ronaldraygun/drawrace-validator:latest`
- `ronaldraygun/drawrace-live:latest`

## Blockers Requiring User Action

### 1. Delete Stuck drawrace Application (HIGH PRIORITY)

The old `drawrace` application is stuck in deletion with `foregroundDeletion` finalizer.
This conflicts with `drawrace-ns-iad-acb` and prevents clean operation.

**Options to resolve:**

**A. Via ArgoCD UI** (easiest if accessible):
```
URL: https://argocd-rs-manager.tail1b1987.ts.net:8080
Navigate: Applications → drawrace → Delete
```

**B. Via kubectl with kubeconfig:**
```bash
# First, regenerate rs-manager.kubeconfig from Rackspace Spot UI
export KUBECONFIG=/home/coding/.kube/rs-manager.kubeconfig

# Remove finalizer to force deletion
kubectl patch application drawrace -n argocd -p '{"metadata":{"finalizers":[]}}' --type=merge

# Delete application
kubectl delete application drawrace -n argocd --force --grace-period=0
```

**C. Via API request** (if UI not accessible):
```bash
# Get ArgoCD admin password
kubectl --server=http://traefik-rs-manager:8001 get pod -n argocd -l app.kubernetes.io/name=argocd-server -o json | jq -r '.items[0].metadata.name'

# Port-forward and use API
kubectl --server=http://traefik-rs-manager:8001 port-forward -n argocd <argocd-server-pod> 8080:8080
curl -X DELETE http://localhost:8080/api/v1/applications/drawrace -u admin:<password>
```

### 2. Create Missing OpenBao Secrets

The following secrets need to be created in OpenBao at `secret/rs-manager/drawrace/*`:

**A. rs-manager/drawrace/postgres** (for drawrace-postgres-credentials):
```bash
# Via kubectl exec to OpenBao
export KUBECONFIG=/home/coding/.kube/rs-manager.kubeconfig
kubectl exec -n openbao openbao-rs-manager-0 -- \
  bao kv put secret/rs-manager/drawrace/postgres \
    username=<db-user> \
    password=<db-password>
```

**B. rs-manager/drawrace/postgres-backup** (for drawrace-postgres-backup-s3):
```bash
kubectl exec -n openbao openbao-rs-manager-0 -- \
  bao kv put secret/rs-manager/drawrace/postgres-backup \
    accessKeyId=<s3-access-key> \
    secretAccessKey=<s3-secret-key>
```

**C. rs-manager/drawrace/s3** (for drawrace-api-s3-credentials):
```bash
kubectl exec -n openbao openbao-rs-manager-0 -- \
  bao kv put secret/rs-manager/drawrace/s3 \
    AWS_ACCESS_KEY_ID=<access-key> \
    AWS_SECRET_ACCESS_KEY=<secret-key> \
    AWS_ENDPOINT_URL=http://armor.ardenone-hub.svc:9000 \
    AWS_REGION=us-east-1
```

### 3. Fix and Re-run Build Workflow

The drawrace-build workflow failed at the test stage. Need to:
1. Investigate why tests failed
2. Fix any test issues in the repo
3. Re-trigger the build workflow

```bash
# Re-trigger after fixing tests
kubectl --kubeconfig=/home/coding/.kube/iad-ci.kubeconfig create -f - <<EOF
apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata:
  generateName: drawrace-build-manual-
  namespace: argo-workflows
spec:
  workflowTemplateRef:
    name: drawrace-build
EOF
```

## What's Already in Place (No Action Needed)

- ✅ Cluster target: iad-acb (Rackspace Spot, IAD region)
- ✅ Kubernetes manifests: k8s/iad-acb/drawrace/
- ✅ ArgoCD ApplicationSet: manifest-appset-iad-acb (auto-creates drawrace-ns-iad-acb)
- ✅ ExternalSecrets configuration (only secrets themselves are missing)
- ✅ Docker Hub registry secret (replicated from ardenone-hub)
- ✅ Network policies
- ✅ Ingress configuration
- ✅ Monitoring (ServiceMonitors - disabled but present)

## Next Steps After Blockers Resolved

1. Verify `drawrace-ns-iad-acb` transitions to Healthy status
2. Verify all ExternalSecrets show SecretSynced
3. Verify pods transition to Running state
4. Verify application is accessible via ingress

## Dependencies

This task unblocks:
- bf-47rz
- bf-1uzl
- bf-1x5r
- bf-3ixf
- bf-3ljs
- bf-20k7
