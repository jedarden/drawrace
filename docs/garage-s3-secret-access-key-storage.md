# Garage S3 secretAccessKey Secure Storage

**Task:** nd-9gi8 - Securely store Garage S3 key secretAccessKey  
**Status:** BLOCKED - Waiting for ardenone-hub cluster recovery  
**Date:** 2026-08-07

## Executive Summary

This document provides the complete procedure for securely storing the Garage S3 `secretAccessKey` once the ardenone-hub cluster is back online. The infrastructure is ready, but cluster connectivity is blocking execution.

## Current Blockers

### Primary Blocker: Cluster Offline
```
❌ ardenone-hub: OFFLINE (60+ days via Tailscale)
❌ Garage operator: Terminating state (113 days)
❌ No existing S3 credentials: None found in any namespace
❌ OpenBao drawrace secrets: Empty
```

### Impact
- Cannot create new Garage S3 keys
- Cannot access existing Garage S3 keys  
- Cannot test S3 connectivity
- Cannot populate OpenBao with S3 credentials

## Intended Secure Storage Architecture

### Multi-Layer Security Design

```
┌─────────────────────────────────────────────────────────────┐
│                    LAYER 1: Garage Operator                  │
│  Creates Kubernetes secrets with temporary S3 credentials    │
│  (Auto-generated, auto-rotated, namespace-scoped)          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    LAYER 2: OpenBao                          │
│  Centralized secret storage with audit trail and RBAC        │
│  Path: secret/rs-manager/drawrace/postgres-backup            │
│  - secretAccessKey (encrypted at rest)                       │
│  - accessKeyId (public identifier)                           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 LAYER 3: ExternalSecrets Operator            │
│  Syncs OpenBao secrets to Kubernetes secrets automatically   │
│  Secret: drawrace-postgres-backup-s3 in drawrace namespace   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              LAYER 4: Authorized Services Only               │
│  - CloudNativePG (postgres backups)                         │
│  - drawrace-api (ghost blob storage)                         │
│  - drawrace-validator (ghost replay verification)             │
└─────────────────────────────────────────────────────────────┘
```

### Access Control

**OpenBao RBAC:**
- Only specific service accounts can read secretAccessKey
- Audit logging enabled for all access
- Token-based authentication with time-limited tokens

**Kubernetes RBAC:**
- ExternalSecrets operator has restricted read access to OpenBao
- Pod service accounts have least-privilege access to secrets
- No direct human access to production secrets

**Network Policies:**
- S3 endpoint access restricted to specific namespaces
- Egress rules allow only Garage S3 endpoints
- No direct internet access to S3 credentials

## Step-by-Step Procedure (When Cluster Available)

### Prerequisites Checklist

Before executing this procedure, verify:

- [ ] ardenone-hub cluster is online (check: `tailscale status | grep ardenone-hub`)
- [ ] Garage pods are running (check: `kubectl get pods -n garage`)
- [ ] Garage operator is functional (check: `kubectl get garagecluster`)
- [ ] OpenBao is accessible (check: `kubectl get pod -n openbao openbao-rs-manager-0`)
- [ ] ExternalSecrets operator is running (check: `kubectl get pods -n external-secrets`)

### Phase 1: Verify Cluster Connectivity

```bash
# Check Tailscale connectivity
tailscale status | grep ardenone-hub
# Expected: "ardenone-hub ... active" (not "offline")

# Test kubectl proxy
kubectl --server=http://traefik-ardenone-hub:8001 get nodes
# Expected: Node information returned

# Verify Garage pods
kubectl --server=http://traefik-ardenone-hub:8001 get pods -n garage
# Expected: Garage pods in "Running" state
```

### Phase 2: Create Garage S3 Keys

**Option A: Using Garage Operator (Recommended)**

```bash
# Apply the GarageKey resources that are already defined
kubectl --server=http://traefik-ardenone-hub:8001 apply -f k8s/garage-resources.yaml

# Verify the GarageKey was created
kubectl --server=http://traefik-ardenone-hub:8001 get garagekey -n garage-operator

# Check that secrets were created
kubectl --server=http://traefik-ardenone-hub:8001 get secrets -n drawrace | grep s3
```

**Expected Results:**
- `drawrace-postgres-backup-key` GarageKey created
- `drawrace-postgres-backup-s3` Kubernetes secret created automatically
- Secret contains `accessKeyId` and `secretAccessKey` keys

**Option B: Manual Garage CLI (Fallback)**

If the Garage operator is still broken:

```bash
# Access Garage pod directly
GARAGE_POD=$(kubectl --server=http://traefik-ardenone-hub:8001 get pods -n garage -o name | head -1)
kubectl --server=http://traefik-ardenone-hub:8001 exec -it $GARAGE_POD -n garage -- /bin/sh

# Inside the pod, create the key
garage key create \
    --name drawrace-postgres-backup \
    --allow-bucket drawrace-pg-backups \
    --allow-read \
    --allow-write \
    --allow-delete

# Save the output - you'll get:
# Key ID: GKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# Secret Key: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### Phase 3: Backup to OpenBao (Primary Secure Storage)

```bash
cd /home/coding/drawrace

# Retrieve credentials from the Kubernetes secret
ACCESS_KEY_ID=$(kubectl --server=http://traefik-ardenone-hub:8001 get secret drawrace-postgres-backup-s3 \
    -n drawrace -o jsonpath='{.data.accessKeyId}' | base64 -d)

SECRET_ACCESS_KEY=$(kubectl --server=http://traefik-ardenone-hub:8001 get secret drawrace-postgres-backup-s3 \
    -n drawrace -o jsonpath='{.data.secretAccessKey}' | base64 -d)

# Store in OpenBao
kubectl exec -n openbao openbao-rs-manager-0 -- \
    bao kv put secret/rs-manager/drawrace/postgres-backup \
    accessKeyId="$ACCESS_KEY_ID" \
    secretAccessKey="$SECRET_ACCESS_KEY"

# Verify storage
kubectl exec -n openbao openbao-rs-manager-0 -- \
    bao kv get secret/rs-manager/drawrace/postgres-backup
```

**Expected Results:**
```
Key              Value
---              -----
accessKeyId      GKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
secretAccessKey  xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### Phase 4: Configure ExternalSecrets

The ExternalSecret is already defined in `k8s/external-secrets.yaml`. Verify it's correctly configured:

```bash
# Check ExternalSecret exists
kubectl get externalsecret drawrace-postgres-backup-s3 -n drawrace

# Check sync status
kubectl get externalsecret drawrace-postgres-backup-s3 -n drawrace -o yaml | grep -A 5 "status:"
```

**Expected Status:**
```yaml
status:
  conditions:
  - lastTransitionTime: "2026-08-07T12:00:00Z"
    message: 'Secret is synced from external secret store.'
    reason: SecretSynced
    status: "True"
    type: Ready
```

If not synced, force a reconciliation:
```bash
kubectl annotate externalsecret drawrace-postgres-backup-s3 \
    -n drawrace force-sync=$(date +%s) --overwrite
```

### Phase 5: Verify Access Controls

```bash
# 1. Verify the Kubernetes secret exists and is properly scoped
kubectl get secret drawrace-postgres-backup-s3 -n drawrace

# 2. Verify only authorized pods can access it
kubectl get pods -n drawrace -o name | xargs -I {} kubectl get {} -n drawrace -o jsonpath='{.spec.serviceAccountName}'

# 3. Verify RBAC for service accounts
kubectl get rolebinding -n drawrace | grep postgres

# 4. Verify network policies allow S3 access
kubectl get networkpolicy -n drawrace -o yaml | grep -A 10 garage
```

**Expected Results:**
- Secret exists only in `drawrace` namespace
- Only Postgres and API pods have service accounts with secret access
- Network policies allow traffic only to Garage S3 endpoints

### Phase 6: Verify Service Integration

```bash
# Test from Postgres pod (simulates backup scenario)
POSTGRES_POD=$(kubectl get pods -n drawrace -l app.kubernetes.io/name=postgresql -o name | head -1)

# Set up test environment
kubectl exec -it $POSTGRES_POD -n drawrace -- /bin/sh -c "
export AWS_ACCESS_KEY_ID=$ACCESS_KEY_ID
export AWS_SECRET_ACCESS_KEY=$SECRET_ACCESS_KEY  
export S3_ENDPOINT_URL=http://garage.ardenone-hub.svc:3900

# Test READ access
aws s3 ls s3://drawrace-pg-backups --endpoint-url \$S3_ENDPOINT_URL

# Test WRITE access  
echo 'test-backup' > /tmp/test-backup.txt
aws s3 cp /tmp/test-backup.txt s3://drawrace-pg-backups/test-backup.txt --endpoint-url \$S3_ENDPOINT_URL

# Test DELETE access
aws s3 rm s3://drawrace-pg-backups/test-backup.txt --endpoint-url \$S3_ENDPOINT_URL
"

# Expected: All three commands succeed without permission errors
```

### Phase 7: Test CloudNativePG Backup Integration

```bash
# Trigger a manual backup
kubectl annotate cluster drawrace-postgres \
    -n drawrace \
    postgresql.cnpg.io/backup=$(date +%s) --overwrite

# Monitor backup progress
kubectl get backup -n drawrace -w

# Check logs for S3 operations
kubectl logs -n drawrace -l app.kubernetes.io/name=postgresql --tail=50 | grep -i s3
```

**Expected Results:**
- Backup completes successfully
- No permission errors in logs
- Files appear in the bucket
- OpenBao audit logs show credential access

## Security Verification Checklist

### Storage Security
- [ ] secretAccessKey stored in OpenBao (not in git)
- [ ] OpenBao encryption at rest enabled
- [ ] No secrets in Kubernetes manifests (only ExternalSecrets)
- [ ] Temporary Garage secrets cleaned up after extraction

### Access Control
- [ ] RBAC restricts secret access to service accounts only
- [ ] No human-readable secrets in etcd (base64 encoded)
- [ ] Network policies restrict S3 endpoint access
- [ ] Audit logging enabled for all secret access

### Operational Security
- [ ] Secret rotation procedure documented
- [ ] Backup and restore procedure tested
- [ ] Incident response plan in place
- [ ] Monitoring and alerting configured

## Acceptance Criteria Verification

### 1. secretAccessKey Retrieval
- [ ] Successfully retrieved from Garage S3 key
- [ ] Verified in OpenBao storage
- [ ] Accessible via ExternalSecret

### 2. Secure Storage Location
- [ ] Stored in OpenBao with encryption
- [ ] Synced to Kubernetes via ExternalSecrets
- [ ] Not committed to git or repository
- [ ] Proper RBAC restrictions in place

### 3. Access Restrictions  
- [ ] Only authorized service accounts can access
- [ ] Network policies enforce endpoint restrictions
- [ ] Audit trail enabled for all access
- [ ] No direct human access to production secrets

### 4. Service Integration Verification
- [ ] CloudNativePG can read credentials
- [ ] Postgres backup successfully uploads to S3
- [ ] API pods can access ghost storage
- [ ] Validator can retrieve ghost blobs

## Monitoring and Alerting

### Metrics to Monitor
- ExternalSecret sync status (`externalsecret_status_ready`)
- S3 upload success rate (`s3_upload_success_rate`)
- Backup completion time (`backup_completion_seconds`)
- Secret access attempts (`secret_access_attempts`)

### Alerts to Configure
- ExternalSecret sync failure
- Backup failure > 24 hours
- Unusual secret access patterns
- S3 connectivity issues

## Rollback Procedure

If issues occur after secret storage:

```bash
# 1. Revert ExternalSecret to previous version
kubectl rollout undo deployment drawrace-postgres -n drawrace

# 2. Remove problematic secret from OpenBao
kubectl exec -n openbao openbao-rs-manager-0 -- \
    bao kv delete secret/rs-manager/drawrace/postgres-backup

# 3. Restore from backup (if available)
kubectl exec -n openbao openbao-rs-manager-0 -- \
    bao kv put secret/rs-manager/drawrace/postgres-backup \
    accessKeyId="<backup-key-id>" \
    secretAccessKey="<backup-secret-key>"

# 4. Force ExternalSecret resync
kubectl annotate externalsecret drawrace-postgres-backup-s3 \
    -n drawrace force-sync=$(date +%s) --overwrite
```

## Troubleshooting

### "OpenBao secret not found"
```bash
# Verify OpenBao pod is running
kubectl get pod -n openbao openbao-rs-manager-0

# Check OpenBao logs
kubectl logs -n openbao openbao-rs-manager-0

# List all secrets
kubectl exec -n openbao openbao-rs-manager-0 -- bao kv list -recursive secret/
```

### "ExternalSecret not syncing"
```bash
# Check ExternalSecret operator
kubectl get pods -n external-secrets

# Check operator logs
kubectl logs -n external-secrets -l app.kubernetes.io/name=external-secrets-operator

# Force reconciliation
kubectl annotate externalsecret drawrace-postgres-backup-s3 \
    -n drawrace force-sync=$(date +%s) --overwrite

# Verify RemoteRef is correct
kubectl get externalsecret drawrace-postgres-backup-s3 -n drawrace -o yaml | grep -A 10 "remoteRef"
```

### "S3 permission denied"
```bash
# Verify secret exists in drawrace namespace
kubectl get secret drawrace-postgres-backup-s3 -n drawrace

# Check secret contents
kubectl get secret drawrace-postgres-backup-s3 -n drawrace -o yaml

# Verify OpenBao secret
kubectl exec -n openbao openbao-rs-manager-0 -- \
    bao kv get secret/rs-manager/drawrace/postgres-backup

# Test S3 connectivity manually
kubectl exec -it drawrace-postgres-0 -n drawrace -- /bin/sh
# Inside pod: test aws s3 commands with credentials
```

## Related Documentation

- `docs/garage-s3-key-creation-procedure.md` - Detailed key creation steps
- `docs/garage-s3-setup.md` - Complete Garage S3 setup guide
- `docs/setup-openbao-secrets.md` - OpenBao configuration
- `k8s/garage-resources.yaml` - Garage resource definitions
- `k8s/external-secrets.yaml` - ExternalSecret configurations
- `scripts/create-garage-s3-key.sh` - Automated key creation script

## Current Status

### Completed
- ✅ **Documentation**: Complete security architecture documented
- ✅ **Procedures**: Step-by-step procedures created
- ✅ **Integration Points**: OpenBao, ExternalSecrets configured
- ✅ **Verification Plans**: Testing and monitoring defined

### Pending (Cluster Offline)
- ❌ **Cluster Access**: ardenone-hub offline (60+ days)
- ❌ **Key Creation**: Cannot execute Garage operator commands
- ❌ **Credential Storage**: Cannot populate OpenBao with actual credentials
- ❌ **Integration Testing**: Cannot verify end-to-end functionality

### Next Steps (When Cluster Available)
1. Verify cluster connectivity and Garage operator status
2. Execute Phase 2: Create Garage S3 keys
3. Execute Phase 3: Backup credentials to OpenBao
4. Execute Phase 4: Configure ExternalSecrets sync
5. Execute Phase 5: Verify access controls
6. Execute Phase 6: Test service integration
7. Execute Phase 7: Verify CloudNativePG backups

## Task Status

**Task nd-9gi8:** BLOCKED - Infrastructure blockers prevent execution

**Acceptance Criteria Status:**
- ⏸️ **Retrieve secretAccessKey**: Blocked (cluster offline)
- ⏸️ **Store securely**: Blocked (no credential to store)
- ✅ **Access restrictions defined**: Architecture documented
- ⏸️ **Verify service access**: Blocked (cannot test without credentials)

**Estimated Completion:** When ardenone-hub cluster returns online (ETA unknown)

---

*Document created for task nd-9gi8*  
*Date: 2026-08-07*  
*Status: Complete documentation, awaiting cluster recovery*