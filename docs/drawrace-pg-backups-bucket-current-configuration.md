# drawrace-pg-backups Bucket - Current Configuration Documentation

**Date**: 2026-06-27 (Updated: 2026-06-27 17:46 UTC)
**Task**: nd-5uw - Document drawrace-pg-backups bucket configuration before creating new S3 key
**Status**: BLOCKED - Cluster Offline (Unchanged)  

## Executive Summary

The `drawrace-pg-backups` bucket configuration is **fully defined in Kubernetes manifests** but **cannot be verified directly** due to ardenone-hub cluster being offline in Tailscale. All configuration details are available from the declarative configuration and existing documentation.

## Cluster Status

### Latest Verification (2026-06-27 17:46 UTC)
❌ **ardenone-hub: OFFLINE**
- Status: Timeout connecting to `http://traefik-ardenone-hub:8001`
- Error: `dial tcp 100.90.7.50:8001: i/o timeout`
- Garage pods: Not accessible via kubectl proxy
- rs-manager Garage: No garage namespace or pods found

### Historical Status
❌ **ardenone-hub: OFFLINE**
- Last seen: 18+ days ago in Tailscale
- kubectl proxy: Timeout (100.90.7.50:8001 unreachable)
- Garage pods: Not accessible
- Garage operator on rs-manager: In "Terminating" state (72 days)

**Impact**: No direct Garage CLI access, cannot verify current bucket state or existing keys

**Verification Attempts Today:**
1. ✅ Checked kubectl proxy to ardenone-hub (timeout)
2. ✅ Checked rs-manager for Garage pods (none found)
3. ✅ Verified postgres-cluster.yaml manifest exists with bucket config

## Bucket Configuration (from manifests)

### Bucket Identity
- **Name**: `drawrace-pg-backups`
- **Purpose**: PostgreSQL backups from CloudNativePG
- **Location**: ardenone-hub Garage S3 cluster
- **S3 Path**: `s3://drawrace-pg-backups/`

### Expected Configuration

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

### Backup Configuration
- **Target**: Primary database instance
- **Retention**: 30 days (`retentionPolicy: "30d"`)
- **Volume Snapshots**: Longhorn (`className: longhorn`)
- **WAL Compression**: gzip
- **Data Compression**: gzip
- **Parallel Jobs**: 2

## Access Pattern Analysis

### Expected Permissions

Based on CloudNativePG backup requirements, the S3 key needs:

**Required Permissions:**
- ✅ **READ**: List/get existing backups (restore operations)
- ✅ **WRITE**: Upload new backups and WAL segments
- ✅ **DELETE**: Remove expired backups (30-day retention enforcement)

**Permission Scope:**
- Single bucket access only: `drawrace-pg-backups`
- No cross-bucket permissions needed
- No administrative permissions needed

### Current Access Method

The backup system expects a Kubernetes secret named `drawrace-postgres-backup-s3` in the `drawrace` namespace containing:
- `accessKeyId`: S3 access key ID
- `secretAccessKey`: S3 secret access key

This secret should be synced from OpenBao via ExternalSecret operator.

## Unknown/Unverified State

Due to cluster being offline, the following **cannot be verified**:

### ❓ Bucket Existence
- Unknown if bucket `drawrace-pg-backups` actually exists
- Unknown if bucket was ever created
- Unknown bucket quotas or settings

### ❓ Existing S3 Keys
- Unknown how many keys currently exist
- Unknown if any keys currently have access to this bucket
- Unknown key permissions or rotation status
- Unknown if the expected `drawrace-postgres-backup-s3` secret exists

### ❓ Garage Configuration
- Unknown Garage cluster configuration
- Unknown if Garage is operational on ardenone-hub
- Unknown S3 endpoint accessibility

## Dependencies

### nd-5m5 - Garage CLI Access (PARENT BEAD)
**Status**: Multiple verification attempts show cluster offline
- `docs/garage-cli-access-verification.md` - Initial verification (blocked)
- `docs/garage-cli-verification-2026-06-27-nd-5m5.md` - Re-verification (still offline)
- `docs/garage-cli-verification-final-2026-06-27.md` - Final verification (still offline)

**Conclusion**: ardenone-hub has been offline for 18+ days; this is a known blocker

## Next Steps (Once Cluster Available)

### Immediate Actions Required

1. **Verify Cluster Connectivity**
   ```bash
   # Wait for ardenone-hub to come back online
   tailscale status | grep ardenone-hub
   kubectl --server=http://traefik-ardenone-hub:8001 get pods -n garage
   ```

2. **Check Bucket Status**
   ```bash
   # Via Garage CLI on cluster
   garage bucket list
   garage bucket info drawrace-pg-backups
   ```

3. **List Existing Keys**
   ```bash
   # Check current key state
   garage key list
   garage key info <existing-key-id>
   ```

4. **Create New Key (if needed)**
   ```bash
   # Create key with appropriate permissions
   garage key create \
     --name drawrace-postgres-backup \
     --allow-bucket drawrace-pg-backups \
     --allow-read \
     --allow-write \
     --allow-delete
   ```

5. **Store Credentials**
   ```bash
   # Use provided script
   ./scripts/create-garage-s3-key.sh
   ```

### Verification Steps

1. **Test Key Permissions**
   ```bash
   # With new credentials
   aws s3 ls s3://drawrace-pg-backups --endpoint-url $GARAGE_ENDPOINT
   aws s3 cp /tmp/test.txt s3://drawrace-pg-backups/test --endpoint-url $GARAGE_ENDPOINT
   aws s3 rm s3://drawrace-pg-backups/test --endpoint-url $GARAGE_ENDPOINT
   ```

2. **Verify Kubernetes Secret**
   ```bash
   kubectl get secret drawrace-postgres-backup-s3 -n drawrace
   kubectl describe secret drawrace-postgres-backup-s3 -n drawrace
   ```

3. **Test Backup Integration**
   ```bash
   # Trigger a manual backup
   kubectl annotate cluster drawrace-postgres \
     -n drawrace \
     postgresql.cnpg.io/backup=$(date +%s)
   
   # Monitor backup progress
   kubectl get backup -n drawrace
   ```

## Security Considerations

### Key Management
- ✅ Keys should be stored in OpenBao (not Kubernetes secrets directly)
- ✅ ExternalSecret operator should sync to Kubernetes
- ✅ Regular key rotation (monthly recommended)
- ✅ Minimal permissions (bucket-specific only)

### Access Audit
- ✅ Enable Garage access logging for audit trail
- ✅ Monitor backup success/failure rates
- ✅ Alert on backup failures > 24h

### Backup Retention
- ✅ 30-day retention policy enforced by CloudNativePG
- ✅ Automatic cleanup of expired backups
- ✅ WAL segments compressed to save space

## Known Issues and Blockers

### Critical Blockers
1. ❌ **ardenone-hub cluster offline** - Primary blocker
2. ❌ **No Garage CLI access** - Cannot verify state or create keys
3. ❌ **Garage operator non-functional** - Operator in terminating state

### Secondary Issues
1. ⚠️ **No existing state documentation** - Unknown if bucket was ever created
2. ⚠️ **Unknown existing key count** - Could be 0 or multiple keys
3. ⚠️ **No backup verification** - Cannot test backup/restore functionality

## Recommendations

### Short-term (Immediate)
1. **Document cluster recovery timeline** - When will ardenone-hub be back online?
2. **Prepare Garage key creation script** - Ready to execute when cluster available
3. **Test backup/restore process** - Once connectivity restored

### Medium-term
1. **Cluster restoration** - Investigate and resolve ardenone-hub offline status
2. **Garage operator assessment** - Determine if operator restoration needed
3. **Backup verification** - Test full backup/restore cycle once available

### Long-term
1. **High availability consideration** - Should backups go to a more reliable cluster?
2. **Monitoring setup** - Implement backup health monitoring
3. **Disaster recovery testing** - Regular restore drills

## Related Documentation

- `CLAUDE.md` - Infrastructure context and Garage S3 information
- `docs/plan/plan.md` - §Multiplayer & Backend 4 (Storage architecture)
- `docs/garage-s3-setup.md` - Detailed Garage S3 setup instructions
- `docs/garage-s3-key-generation-current-status.md` - Previous investigation results
- `k8s/postgres-cluster.yaml` - CloudNativePG backup configuration
- `docs/garage-cli-verification-final-2026-06-27.md` - Latest cluster status check

## Conclusion

The `drawrace-pg-backups` bucket configuration is **fully specified in declarative configuration** but **cannot be verified or implemented** due to the ardenone-hub cluster being offline. 

**What we know:**
- ✅ Bucket name and purpose defined
- ✅ Required permissions documented (READ/WRITE/DELETE)
- ✅ Access pattern understood (PostgreSQL backups via CloudNativePG)
- ✅ Integration points defined (Kubernetes secret, OpenBao, ExternalSecret)

**What we don't know (cluster offline):**
- ❌ If bucket exists
- ❌ Current bucket state and configuration
- ❌ Existing S3 keys and their permissions
- ❌ Garage cluster operational status

**Next action**: Wait for ardenone-hub cluster recovery, then proceed with bucket verification and key creation.

---

**Document Status**: ✅ Documentation Complete (2026-06-27 17:46 UTC)
**Verification Status**: ❌ Still Blocked - ardenone-hub cluster offline
**Next Bead**: Proceed with bucket verification and key creation once cluster is online
**Dependencies**: nd-5m5 (Garage CLI access) - BLOCKED on cluster availability

**Task nd-5uw Summary**: Bucket configuration documented from postgres-cluster.yaml manifest. All required permissions and access patterns documented. Cannot verify actual bucket state or list existing keys due to cluster being offline.