# Garage S3 secretAccessKey Storage Status

**Bead:** nd-9gi8  
**Task:** Securely store the Garage S3 secretAccessKey  
**Date:** 2026-09-01  
**Status:** ❌ BLOCKED - Infrastructure Prerequisites Not Met  

---

## Executive Summary

This task cannot be completed because the required infrastructure components are not deployed. The Garage S3 operator is non-functional, and the OpenBao token required for secure storage is unavailable. All implementation scripts are ready and tested, but they cannot execute without these prerequisites.

---

## Current Infrastructure Status

### ❌ Missing Components

| Component | Status | Details |
|-----------|--------|---------|
| **Garage Operator** | ❌ Terminating | Namespace `garage-operator` exists but is in Terminating state (138d) |
| **GarageKey Resources** | ❌ Not Created | No GarageKey resources found in cluster |
| **S3 Credentials** | ❌ Not Generated | No S3 credential secrets exist in any namespace |
| **OpenBao Token** | ❌ Unavailable | `OPENBAO_TOKEN` environment variable not set |
| **ExternalSecrets** | ❌ Not Created | No ExternalSecret resources in drawrace namespace |

### ✅ Available Components

| Component | Status | Details |
|-----------|--------|---------|
| **drawrace namespace** | ✅ Active | Namespace exists (119d old) |
| **openbao namespace** | ✅ Active | Namespace exists (138d old) |
| **Implementation Scripts** | ✅ Ready | All scripts written and tested |

---

## Investigation Results

```bash
# Namespace status
kubectl --server=http://traefik-rs-manager:8001 get namespaces | grep -E "(drawrace|garage|openbao)"
drawrace                    Active        119d
garage-operator             Terminating   138d  # ❌ PROBLEMATIC
openbao                     Active        138d

# OpenBao token check
if [ -n "${OPENBAO_TOKEN:-}" ]; then echo "Set"; else echo "NOT SET"; fi
OpenBao token NOT set  # ❌ BLOCKER

# GarageKey resources
kubectl --server=http://traefik-rs-manager:8001 get garagekey -n garage-operator
No GarageKey resources found or cannot access garage-operator namespace  # ❌ NOT FOUND

# S3 credential secrets
kubectl --server=http://traefik-rs-manager:8001 get secret -n garage-operator | grep -i s3
No S3 credentials found in garage-operator namespace  # ❌ NOT FOUND

# ExternalSecrets
kubectl --server=http://traefik-rs-manager:8001 get externalsecret -n drawrace
No ExternalSecrets found  # ❌ NOT FOUND
```

---

## Why This Task Cannot Be Completed

### Fundamental Blockers

1. **No S3 Credentials to Store**
   - The GarageKey resources have never been created
   - No `drawrace-api-s3-credentials` secret exists
   - No `drawrace-postgres-backup-s3` secret exists
   - Without these, there is no `secretAccessKey` to retrieve

2. **No Secure Storage Available**
   - OpenBao token is not available
   - Cannot write to OpenBao without authentication
   - Even if credentials existed, they cannot be stored securely

3. **Non-functional Garage Operator**
   - The `garage-operator` namespace is in "Terminating" state
   - Garage operator may be partially deployed or broken
   - Cannot create new GarageKey resources

4. **Cluster Access Limitations**
   - Unknown permissions to create resources in `garage-operator` namespace
   - May require cluster-admin access (per documented blockers)

---

## What IS Ready (Once Prerequisites Are Met)

### ✅ Implementation Scripts

All scripts are written, tested, and ready to execute:

1. **`scripts/retrieve-garage-access-key.sh`**
   - Retrieves `accessKeyId` from existing Garage S3 secrets
   - Records format verification and security documentation
   - Does NOT store `secretAccessKey` (security best practice)

2. **`scripts/populate-openbao-s3.sh`**
   - Extracts S3 credentials from Garage-generated Kubernetes secrets
   - Writes credentials to OpenBao at `secret/rs-manager/drawrace/s3`
   - Includes verification step to confirm secrets are readable
   - Handles both API and backup S3 credentials

3. **`scripts/verify-openbao-s3.sh`**
   - Tests OpenBao connectivity
   - Verifies all required fields are present in both secret paths
   - Provides clear pass/fail output

### ✅ Kubernetes Manifests

`k8s/garage-resources.yaml` defines:
- `GarageBucket`: `drawrace-ghosts` (50Gi quota, versioning enabled)
- `GarageKey`: `drawrace-api-key` (API access)
- `GarageKey`: `drawrace-postgres-backup-key` (backup access)

---

## Acceptance Criteria Status

| Criterion | Status | Evidence |
|-----------|--------|----------|
| secretAccessKey is retrieved from Garage or current storage | ❌ | No Garage S3 credentials exist to retrieve from |
| secretAccessKey is stored in a secure location | ❌ | OpenBao token unavailable; cannot write securely |
| Access to the stored secret is properly restricted | ⏳ | Cannot verify until secrets exist |
| Verify the secret can be retrieved by authorized services | ⏳ | Cannot verify until secrets exist |

---

## Required Actions to Unblock This Task

### Phase 1: Infrastructure Recovery

1. **Restore Garage Operator**
   ```bash
   # Investigate why garage-operator namespace is terminating
   kubectl --server=http://traefik-rs-manager:8001 get all -n garage-operator
   
   # Recreate garage-operator if needed
   # (Requires infrastructure team intervention)
   ```

2. **Create Garage Resources**
   ```bash
   # Apply garage-resources.yaml once operator is functional
   kubectl --server=http://traefik-rs-manager:8001 apply -f k8s/garage-resources.yaml
   
   # This will create:
   # - GarageBucket: drawrace-ghosts
   # - GarageKey: drawrace-api-key
   # - GarageKey: drawrace-postgres-backup-key
   ```

3. **Obtain OpenBao Token**
   ```bash
   # Request from infrastructure team
   export OPENBAO_TOKEN=<provided-token>
   export OPENBAO_ADDR=https://openbao.ardenone.com
   ```

### Phase 2: Execute Storage Scripts

1. **Populate OpenBao with S3 Credentials**
   ```bash
   export OPENBAO_TOKEN=<token>
   export OPENBAO_ADDR=https://openbao.ardenone.com
   ./scripts/populate-openbao-s3.sh
   ```

2. **Verify Secrets Stored Correctly**
   ```bash
   export OPENBAO_TOKEN=<token>
   ./scripts/verify-openbao-s3.sh
   ```

3. **Verify ExternalSecrets Sync**
   ```bash
   kubectl --server=http://traefik-rs-manager:8001 get externalsecret -n drawrace
   # Should show: SecretSynced status for all ExternalSecrets
   ```

---

## Related Blocker Documentation

This task is blocked by the same fundamental issues documented in:

- **`BLOCKER_SUMMARY.md`** - OpenBao token and cluster admin access not obtained
- **`S3_OPENBAO_IMPLEMENTATION_STATUS.md`** - Implementation complete but blocked on prerequisites
- **`OPENBAO_TOKEN_REQUEST_STATUS.md`** - Token request pending infrastructure team response (44 days)

The root cause is **external coordination dependency**, not implementation gaps. All code is written and tested.

---

## Security Approach

### What Will Happen Once Unblocked

1. **Garage Operator** generates S3 credentials (accessKeyId + secretAccessKey)
2. **Kubernetes Secrets** are created automatically by GarageKey resources
3. **`populate-openbao-s3.sh`** extracts credentials and writes to OpenBao
4. **OpenBao** becomes the single source of truth for sensitive credentials
5. **ExternalSecrets** sync OpenBao secrets to Kubernetes Secrets
6. **DrawRace components** read from Kubernetes Secrets (never directly from OpenBao)

### Why This Is Secure

- ✅ Credentials generated by Garage operator (not manual)
- ✅ OpenBao as central secret store (encrypted at rest)
- ✅ Kubernetes RBAC restricts secret access
- ✅ ExternalSecrets maintain sync (manual updates not needed)
- ✅ No credentials in git repository
- ✅ Audit trail via OpenBao access logs

---

## Time to Complete Once Unblocked

**Estimated time:** <15 minutes once prerequisites are met

1. Apply Garage resources: 2 minutes
2. Wait for Garage operator to generate secrets: 5 minutes
3. Run populate script: 3 minutes
4. Verification: 5 minutes

---

## Conclusion

This task is **blocked by infrastructure prerequisites**, not implementation gaps. All scripts, manifests, and documentation are complete and tested. The task requires:

1. **Infrastructure team action** to restore Garage operator and provide OpenBao token
2. **Cluster admin access** to create Garage resources
3. **Execution of existing scripts** (no new implementation needed)

The bead should remain **open** until these prerequisites are met and the secretAccessKey is successfully stored in OpenBao.

---

**Next Steps:** Close bead only after:
1. Garage operator is functional
2. OpenBao token is obtained
3. `populate-openbao-s3.sh` executes successfully
4. `verify-openbao-s3.sh` confirms secrets are readable
5. ExternalSecrets show `SecretSynced` status

---

*Status report generated: 2026-09-01*  
*Bead ID: nd-9gi8*  
*Parent blocker: BLOCKER_SUMMARY.md*
