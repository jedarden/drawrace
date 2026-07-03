# DrawRace Infrastructure Permissions Request

**Date:** 2026-07-02
**Bead ID:** nd-1fkb
**Status:** 🔴 BLOCKER - Awaiting Infrastructure Team Response

---

## Executive Summary

DrawRace deployment is blocked because we lack:
1. **OpenBao root token** to create required secrets
2. **Cluster admin permissions** on `iad-acb` to create Garage resources

Without these, we cannot complete the OpenBao secrets setup, which blocks all DrawRace deployment work.

---

## Request Details

### 1. OpenBao Root Token

**Required for:** Creating DrawRace secrets in OpenBao via API

**What we need:**
- OpenBao root token (or permission to create one)
- Token should be provided via secure channel (NOT in this document)

**How it will be used:**
```bash
export OPENBAO_TOKEN="<provided-token>"
export OPENBAO_ADDR="http://openbao.external-secrets.svc.cluster.local:8200"
```

The token will be used by the setup script (`scripts/setup-openbao-secrets.sh`) to create secrets at:
- `secret/data/rs-manager/drawrace/s3` (API S3 credentials)
- `secret/data/rs-manager/drawrace/postgres-backup` (Postgres backup S3)
- `secret/data/rs-manager/drawrace/postgres` (Postgres credentials)

**Security considerations:**
- Token will be rotated after use
- Never committed to version control
- Only used for initial secret creation
- Script revokes/cleans up after completion

---

### 2. Cluster Admin Permissions on iad-acb

**Current access:** Read-only via `devpod-observer` service account
**Required access:** Cluster admin (or equivalent) to create:

1. **GarageBucket** in `garage-operator` namespace:
   - Resource: `drawrace-ghosts`
   - Quota: 50Gi
   - Versioning: enabled

2. **GarageKey** resources in `garage-operator` namespace:
   - `drawrace-api-key` (for API S3 access)
   - `drawrace-postgres-backup-key` (for Postgres backup S3 access)

3. **Temporary secrets** in `garage-operator` namespace:
   - Created by Garage operator automatically
   - Used to extract S3 credentials
   - Cleaned up after OpenBao population

**Verification test:**
```bash
kubectl --server=http://traefik-iad-acb:8001 \
  auth can-i create garagebucket -n garage-operator
# Expected: yes
```

---

## Why This Is Needed

The DrawRace deployment requires three ExternalSecrets that are currently failing:

```
NAME                            STATUS              READY
drawrace-api-s3-credentials     SecretSyncedError   False
drawrace-postgres-backup-s3     SecretSyncedError   False
drawrace-postgres-credentials   SecretSyncedError   False
```

**Error:** `could not get secret data from provider`

**Root cause:** The secrets don't exist in OpenBao, and we can't create them without:
1. OpenBao root token (for secret creation)
2. Cluster admin permissions (for Garage resource creation to get S3 credentials)

---

## What We'll Do Once Permissions Are Granted

### Step 1: Create Garage Resources
Using cluster admin permissions, we'll create:
- `GarageBucket drawrace-ghosts` (50Gi, versioned)
- `GarageKey drawrace-api-key` (API S3 access)
- `GarageKey drawrace-postgres-backup-key` (backup S3 access)

### Step 2: Extract S3 Credentials
Extract credentials from Garage-generated secrets (automatically created by operator)

### Step 3: Create OpenBao Secrets
Using OpenBao root token, create secrets via API at:
- `secret/data/rs-manager/drawrace/s3`
- `secret/data/rs-manager/drawrace/postgres-backup`
- `secret/data/rs-manager/drawrace/postgres`

### Step 4: Verify ExternalSecrets Sync
All three ExternalSecrets should transition to `SecretSynced` status

### Step 5: Security Cleanup
- Rotate OpenBao root token
- Remove temporary Garage secrets
- Document completed setup

---

## Implementation Approach

We have an automated script that handles the entire process:

```bash
# Set credentials (once provided)
export OPENBAO_TOKEN="<provided-token>"

# Run setup
./scripts/setup-openbao-secrets.sh
```

**The script:**
1. ✅ Checks cluster access
2. ✅ Creates GarageBucket and GarageKeys
3. ✅ Extracts S3 credentials
4. ✅ Generates secure Postgres credentials
5. ✅ Populates OpenBao secrets
6. ✅ Verifies ExternalSecrets sync
7. ✅ Cleans up temporary secrets

---

## Documentation

Full context is available in:
- **Task handoff:** `docs/openbao-secrets-task-handoff.md`
- **Setup guide:** `docs/openbao-secrets-creation-guide.md`
- **Execution checklist:** `docs/openbao-secrets-execution-checklist.md`
- **OpenBao secret mapping:** `docs/openbao-secrets.md`

---

## Current Blockers

| Item | Status | Notes |
|------|--------|-------|
| OpenBao root token | ❌ BLOCKED | Awaiting infrastructure team |
| Cluster admin permissions | ❌ BLOCKED | Awaiting infrastructure team |
| Setup script | ✅ Ready | `scripts/setup-openbao-secrets.sh` |
| Documentation | ✅ Complete | All docs in `docs/openbao-secrets-*` |

---

## Contact & Next Steps

**To proceed, we need from infrastructure team:**

1. **OpenBao root token** (provide securely, not in this document)
2. **Cluster admin permissions** on `iad-acb` cluster for creating Garage resources

**Once received:**
1. Update this document with "Received" status
2. Run `./scripts/setup-openbao-secrets.sh`
3. Verify ExternalSecrets sync successfully
4. Update documentation with completion status
5. Close bead nd-1fkb

---

**Blocked Work:**
- All DrawRace deployment and configuration work
- OpenBao secrets creation
- ExternalSecrets sync verification
- Postgres and S3 credential management

---

**Priority:** 🔴 **P0 - CRITICAL BLOCKER**

**Estimated time to unblock:** 5 minutes (once permissions granted)

**Total work remaining after permissions:** ~10 minutes (script execution + verification)

---

## Readiness Status

### ✅ Complete - Ready for Execution

- [x] Infrastructure permissions request document (this file)
- [x] OpenBao secrets setup guide (`docs/openbao-secrets-creation-guide.md`)
- [x] Execution checklist (`docs/openbao-secrets-execution-checklist.md`)
- [x] Secret path documentation (`docs/openbao-secrets.md`)
- [x] Task handoff document (`docs/openbao-secrets-task-handoff.md`)
- [x] Automated setup script (`scripts/setup-openbao-secrets.sh`)
- [x] Verification test: Current GarageBucket permission = `no` (as expected)

### ❌ Pending - Awaiting Infrastructure Team

- [ ] OpenBao root token provided
- [ ] Cluster admin permissions granted on iad-acb
- [ ] Permission verified: `kubectl auth can-i create garagebucket -n garage-operator` returns `yes`

### 📋 Next Actions (for Infrastructure Team)

1. **Provide OpenBao root token** via secure channel
2. **Grant cluster admin permissions** on iad-acb cluster
3. **Notify** when permissions are ready

### 📋 Next Actions (for DrawRace Team, once permissions granted)

1. Set `OPENBAO_TOKEN` environment variable
2. Run `./scripts/setup-openbao-secrets.sh`
3. Verify ExternalSecrets sync successfully
4. Document completion and close bead nd-1fkb
