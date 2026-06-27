# Garage S3 Key Creation Procedure for drawrace-pg-backups

**Task**: nd-1wf - Create Garage S3 key for drawrace-pg-backups bucket
**Date**: 2026-06-27
**Status**: DOCUMENTED - Ready for execution when cluster is online

## Executive Summary

This document provides the complete procedure for creating a new Garage S3 API key with write access to the `drawrace-pg-backups` bucket. The procedure is documented and ready but **cannot be executed until the ardenone-hub cluster is back online** (currently offline for 18+ days).

## Prerequisites

### Required Access
1. **Garage CLI access** on ardenone-hub cluster
2. **kubectl proxy** or **Tailscale network** access to Garage
3. **OpenBao access** on rs-manager cluster for credential storage
4. **ExternalSecret operator** running in drawrace namespace

### Cluster Status (Current)
```
❌ ardenone-hub: OFFLINE (18+ days)
❌ Garage CLI: Not accessible
❌ kubectl proxy: Timeout (100.90.7.50:8001 unreachable)
```

## Permission Pattern Analysis

### CloudNativePG Backup Requirements

Based on the postgres-cluster.yaml manifest and CloudNativePG backup patterns, the S3 key requires:

**Required Permissions:**
- ✅ **READ** (`--allow-read`): List/get existing backups for restore operations
- ✅ **WRITE** (`--allow-write`): Upload new backups and WAL segments
- ✅ **DELETE** (`--allow-delete`): Remove expired backups (30-day retention enforcement)

**Permission Scope:**
- Single bucket access only: `drawrace-pg-backups`
- No cross-bucket permissions needed
- No administrative permissions needed

### Access Pattern Analysis

From `k8s/postgres-cluster.yaml`:

```yaml
barmanObjectStore:
  destinationPath: "s3://drawrace-pg-backups/"
  endpointURL: "http://garage.ardenone-hub.svc:3900"
  s3Credentials:
    accessKeyId:
      name: drawrace-postgres-backup-s3
      key: accessKeyId
    secretAccessKey:
      name: drawrace-postgres-backup-s3
      key: secretAccessKey
  wal:
    compression: gzip
  data:
    compression: gzip
    jobs: 2
```

## Step-by-Step Procedure

### Step 1: Verify Cluster Connectivity

**When cluster comes back online:**

```bash
# Check Tailscale status
tailscale status | grep ardenone-hub

# Test kubectl proxy
kubectl --server=http://traefik-ardenone-hub:8001 get pods -n garage

# Verify Garage pods are running
kubectl --server=http://traefik-ardenone-hub:8001 get pods -n garage
```

**Expected Results:**
- `ardenone-hub` shows as "active" in Tailscale
- kubectl proxy responds successfully
- Garage pods are in "Running" state

### Step 2: Create or Verify Bucket

```bash
# Set Garage endpoint
export GARAGE_RPC_ENDPOINT=http://garage.ardenone-hub.svc:3900

# OR use Tailscale access
export GARAGE_RPC_ENDPOINT=http://garage.ardenone-hub.tail1b1987.ts.net:3900

# Check if bucket exists
garage bucket list

# Create bucket if it doesn't exist
garage bucket create drawrace-pg-backups

# Verify bucket creation
garage bucket info drawrace-pg-backups
```

### Step 3: Create S3 Key with Appropriate Permissions

**Primary Method - Direct Garage CLI:**

```bash
# Create S3 key with read, write, and delete access
garage key create \
    --name drawrace-postgres-backup \
    --allow-bucket drawrace-pg-backups \
    --allow-read \
    --allow-write \
    --allow-delete
```

**Expected Output:**
```
Key ID: GKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
Secret Key: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**Save these credentials securely** - you'll need them for the next step.

### Alternative Method 1 - Kubectl Pod Exec

```bash
# Find a Garage pod
kubectl --server=http://traefik-ardenone-hub:8001 get pods -n garage

# Exec into a Garage pod
kubectl --server=http://traefik-ardenone-hub:8001 exec -it <garage-pod-name> -n garage -- /bin/sh

# Inside the pod, run Garage CLI
garage key create \
    --name drawrace-postgres-backup \
    --allow-bucket drawrace-pg-backups \
    --allow-read \
    --allow-write \
    --allow-delete
```

### Alternative Method 2 - Via Tailscale Network

```bash
# Set up Tailscale access
export GARAGE_RPC_ENDPOINT=http://garage.ardenone-hub.tail1b1987.ts.net:3900

# Test connectivity
garage bucket list

# Create key
garage key create \
    --name drawrace-postgres-backup \
    --allow-bucket drawrace-pg-backups \
    --allow-read \
    --allow-write \
    --allow-delete
```

### Step 4: Store Credentials in OpenBao

Once you have the Access Key ID and Secret Access Key:

```bash
cd /home/coding/drawrace
./scripts/create-garage-s3-key.sh
```

The script will prompt for:
- `Access Key ID`: Enter the key ID from Step 3
- `Secret Access Key`: Enter the secret key from Step 3

The script will:
1. Store credentials in OpenBao at: `secret/rs-manager/drawrace/postgres-backup`
2. Trigger automatic sync to ExternalSecret `drawrace-postgres-backup-s3`

### Step 5: Verify Secret Creation

```bash
# Check OpenBao secret
kubectl exec -n openbao openbao-rs-manager-0 -- \
    bao kv get secret/rs-manager/drawrace/postgres-backup

# Check ExternalSecret sync
kubectl get externalsecret drawrace-postgres-backup-s3 -n drawrace

# Check Kubernetes secret
kubectl get secret drawrace-postgres-backup-s3 -n drawrace
```

**Expected Results:**
- OpenBao secret contains `accessKeyId` and `secretAccessKey`
- ExternalSecret shows `READY STATE: True`
- Kubernetes secret exists in drawrace namespace

### Step 6: Verify Key Permissions

Test that the key has appropriate permissions for the drawrace-pg-backups bucket:

```bash
# Set up test environment
export AWS_ACCESS_KEY_ID=<your-access-key>
export AWS_SECRET_ACCESS_KEY=<your-secret-key>
export S3_ENDPOINT_URL=http://garage.ardenone-hub.svc:3900

# Test READ access (list bucket)
aws s3 ls s3://drawrace-pg-backups --endpoint-url $S3_ENDPOINT_URL

# Test WRITE access (upload test file)
echo "backup-test" > /tmp/test-backup.txt
aws s3 cp /tmp/test-backup.txt s3://drawrace-pg-backups/test-backup.txt --endpoint-url $S3_ENDPOINT_URL

# Test DELETE access (remove test file)
aws s3 rm s3://drawrace-pg-backups/test-backup.txt --endpoint-url $S3_ENDPOINT_URL

# Verify cleanup
aws s3 ls s3://drawrace-pg-backups --endpoint-url $S3_ENDPOINT_URL
```

**Expected Results:**
- READ command succeeds (can list bucket contents)
- WRITE command succeeds (can upload files)
- DELETE command succeeds (can remove files)
- No permission errors

### Step 7: Test Backup Integration

```bash
# Trigger a manual backup
kubectl annotate cluster drawrace-postgres \
    -n drawrace \
    postgresql.cnpg.io/backup=$(date +%s) --overwrite

# Monitor backup progress
kubectl get backup -n drawrace -w

# Check backup logs
kubectl logs -n drawrace -l app.kubernetes.io/name=postgresql --tail=50
```

**Expected Results:**
- Backup completes successfully
- No S3 permission errors in logs
- Files appear in the bucket

## Verification Checklist

### Cluster Connectivity
- [ ] ardenone-hub is online in Tailscale
- [ ] kubectl proxy responds successfully
- [ ] Garage pods are running

### Bucket and Key Creation
- [ ] Bucket `drawrace-pg-backups` exists
- [ ] S3 key created successfully
- [ ] Key has READ permission
- [ ] Key has WRITE permission
- [ ] Key has DELETE permission
- [ ] Key access is scoped to `drawrace-pg-backups` only

### Secret Storage
- [ ] Credentials stored in OpenBao
- [ ] ExternalSecret synced successfully
- [ ] Kubernetes secret created

### Integration Testing
- [ ] READ access verified
- [ ] WRITE access verified
- [ ] DELETE access verified
- [ ] CloudNativePG backup successful

## Troubleshooting

### "Unable to connect to Garage" Error

```bash
# Check cluster status
tailscale status | grep ardenone-hub

# Check kubectl proxy
kubectl --server=http://traefik-ardenone-hub:8001 get nodes

# Check Garage pods
kubectl --server=http://traefik-ardenone-hub:8001 get pods -n garage
```

### "Key permission denied" Errors

```bash
# Verify key permissions
garage key info <key-id>

# Check bucket access
garage bucket info drawrace-pg-backups

# Create new key with explicit permissions
garage key create \
    --name drawrace-postgres-backup \
    --allow-bucket drawrace-pg-backups \
    --allow-read \
    --allow-write \
    --allow-delete
```

### ExternalSecret Not Syncing

```bash
# Check external-secrets-operator logs
kubectl logs -n external-secrets deployment/external-secrets-operator

# Force sync
kubectl annotate externalsecret drawrace-postgres-backup-s3 \
    -n drawrace force-sync=$(date +%s) --overwrite

# Check ExternalSecret status
kubectl get externalsecret drawrace-postgres-backup-s3 -n drawrace -o yaml
```

### Backup Fails with S3 Errors

```bash
# Check Postgres pod logs
kubectl logs -n drawrace -l app.kubernetes.io/name=postgresql --tail=100

# Verify secret exists
kubectl get secret drawrace-postgres-backup-s3 -n drawrace

# Test S3 connectivity from Postgres pod
kubectl exec -it -n drawrace drawrace-postgres-0 -- \
    aws s3 ls s3://drawrace-pg-backups --endpoint-url http://garage.ardenone-hub.svc:3900
```

## Security Considerations

### Key Management Best Practices
- ✅ Keys are stored in OpenBao (not Kubernetes secrets directly)
- ✅ ExternalSecret operator syncs to Kubernetes
- ✅ Regular key rotation (monthly recommended)
- ✅ Minimal permissions (bucket-specific only)
- ✅ No administrative permissions granted

### Access Audit Trail
- ✅ Enable Garage access logging for audit
- ✅ Monitor backup success/failure rates
- ✅ Alert on backup failures > 24h
- ✅ Review key access quarterly

### Backup Security
- ✅ 30-day retention policy enforced by CloudNativePG
- ✅ Automatic cleanup of expired backups
- ✅ WAL segments compressed to save space
- ✅ Bucket access limited to Postgres pods only

## Current Status

### Completed
- ✅ **Documentation**: Complete procedure documented
- ✅ **Script**: Automated credential storage script ready
- ✅ **Integration Points**: OpenBao, ExternalSecret, CloudNativePG configured
- ✅ **Permission Pattern**: Read/Write/Delete for single bucket

### Pending (Cluster Offline)
- ❌ **Cluster Access**: ardenone-hub offline (18+ days)
- ❌ **Key Creation**: Cannot execute Garage CLI commands
- ❌ **Verification**: Cannot test key permissions
- ❌ **Integration Testing**: Cannot test backup process

### Next Steps (When Cluster Online)
1. Verify cluster connectivity and Garage pod status
2. Execute Step 2: Create/verify bucket
3. Execute Step 3: Create S3 key with permissions
4. Execute Step 4: Store credentials in OpenBao
5. Execute Step 5: Verify secret creation
6. Execute Step 6: Verify key permissions
7. Execute Step 7: Test backup integration

## Related Documentation

- `docs/garage-s3-setup.md` - Detailed Garage S3 setup instructions
- `docs/drawrace-pg-backups-bucket-current-configuration.md` - Bucket configuration details
- `scripts/create-garage-s3-key.sh` - Automated credential storage script
- `k8s/postgres-cluster.yaml` - CloudNativePG backup configuration
- `CLAUDE.md` - Infrastructure context and Garage S3 information

## Conclusion

The complete S3 key creation procedure is documented and ready for execution. All permission patterns, verification steps, and troubleshooting guides are in place. The procedure **cannot be executed until the ardenone-hub cluster is back online**, but everything is prepared for immediate execution once connectivity is restored.

**Acceptance Criteria Status:**
- ✅ New S3 key creation procedure documented via Garage CLI
- ✅ Key has write access to drawrace-pg-backups bucket (documented)
- ⏸️ Key creation confirmed (blocked by cluster offline - procedure ready)
- ✅ Access scoped appropriately (single bucket, read/write/delete only)

**Task nd-1wf Status:** DOCUMENTED - Ready for execution when cluster is online
