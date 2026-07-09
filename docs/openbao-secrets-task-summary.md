# DrawRace OpenBao Secrets - Task Summary & Status

**Bead ID:** nd-2636  
**Task:** Create DrawRace secrets in OpenBao  
**Status:** 🟡 Documentation Complete - Awaiting OpenBao Root Token  
**Created:** 2026-07-02

---

## Current Status

### ✅ Completed

1. **Documentation Created**
   - `docs/openbao-secrets.md` - Secret paths and requirements mapping
   - `docs/setup-openbao-secrets.md` - Detailed setup instructions
   - `docs/openbao-secrets-creation-guide.md` - Comprehensive execution guide
   - `docs/openbao-secrets-execution-checklist.md` - Step-by-step checklist
   - `scripts/setup-openbao-secrets.sh` - Automated setup script

2. **ExternalSecrets Configured**
   - All 4 ExternalSecrets defined in Kubernetes
   - ClusterSecretStore `openbao` configured
   - Refresh interval: 1 hour

3. **One Secret Already Syncing**
   - ✅ `docker-hub-registry` - Synced successfully

### ❌ Pending OpenBao Root Token

Three ExternalSecrets are failing because OpenBao secrets don't exist:

- ❌ `drawrace-api-s3-credentials` - Requires OpenBao secret at `rs-manager/drawrace/s3`
- ❌ `drawrace-postgres-backup-s3` - Requires OpenBao secret at `rs-manager/drawrace/postgres-backup`
- ❌ `drawrace-postgres-credentials` - Requires OpenBao secret at `rs-manager/drawrace/postgres`

---

## Acceptance Criteria Status

| Criterion | Status | Notes |
|-----------|--------|-------|
| All required secret paths exist in OpenBao | ❌ Pending | Awaiting OpenBao root token |
| Each secret contains all required keys/values | ❌ Pending | Will be populated by setup script |
| Secrets are accessible to the ExternalSecretOperator service account | ✅ Complete | ClusterSecretStore configured correctly |

---

## What Needs to Be Done

### Prerequisites

1. **Obtain OpenBao Root Token**
   - Contact cluster administrator
   - Token required for OpenBao API authentication
   - Token will be used to write secrets to OpenBao KV store

### Execution Steps

Once you have the OpenBao root token:

```bash
# Step 1: Set the token
export OPENBAO_TOKEN="<paste-root-token-here>"

# Step 2: Run the automated setup script
cd /home/coding/drawrace
./scripts/setup-openbao-secrets.sh

# Step 3: Verify success
kubectl --server=http://traefik-iad-acb:8001 get externalsecrets -n drawrace
```

**Expected Result:**
```
NAME                            STATUS              READY
docker-hub-registry             SecretSynced        True
drawrace-api-s3-credentials     SecretSynced        True
drawrace-postgres-backup-s3     SecretSynced        True
drawrace-postgres-credentials   SecretSynced        True
```

### What the Script Does

The automated script performs the following:

1. Creates `GarageBucket drawrace-ghosts` (50Gi quota, versioning enabled)
2. Creates `GarageKey drawrace-api-key` for API S3 access
3. Creates `GarageKey drawrace-postgres-backup-key` for backup S3 access
4. Extracts S3 credentials from Garage-generated secrets
5. Generates secure Postgres credentials (25-char alphanumeric password)
6. Populates OpenBao with all three secrets:
   - `secret/data/rs-manager/drawrace/s3` - API S3 credentials
   - `secret/data/rs-manager/drawrace/postgres-backup` - Postgres backup S3 credentials
   - `secret/data/rs-manager/drawrace/postgres` - Postgres database credentials
7. Verifies ExternalSecrets sync successfully
8. Cleans up temporary Garage secrets

---

## Secret Details

### 1. API S3 Credentials

**OpenBao Path:** `secret/data/rs-manager/drawrace/s3`  
**ExternalSecret:** `drawrace-api-s3-credentials`  
**Purpose:** S3 access for DrawRace API ghost blob storage

**Required Keys:**
- `AWS_ACCESS_KEY_ID` - Garage-generated S3 access key ID
- `AWS_SECRET_ACCESS_KEY` - Garage-generated S3 secret key
- `AWS_ENDPOINT_URL` - Garage S3 endpoint (e.g., `https://s3.ardenone.com`)
- `AWS_REGION` - S3 region (`garage`)

### 2. Postgres Backup S3 Credentials

**OpenBao Path:** `secret/data/rs-manager/drawrace/postgres-backup`  
**ExternalSecret:** `drawrace-postgres-backup-s3`  
**Purpose:** S3 access for Postgres backups to `cnpg-backups` bucket

**Required Keys:**
- `accessKeyId` - Garage-generated S3 access key ID
- `secretAccessKey` - Garage-generated S3 secret key

### 3. Postgres Database Credentials

**OpenBao Path:** `secret/data/rs-manager/drawrace/postgres`  
**ExternalSecret:** `drawrace-postgres-credentials`  
**Purpose:** Postgres superuser credentials for DrawRace database

**Required Keys:**
- `username` - Postgres username (`drawrace`)
- `password` - 25-character randomly generated password

---

## Verification Commands

### Check ExternalSecret Status

```bash
kubectl --server=http://traefik-iad-acb:8001 get externalsecrets -n drawrace
```

### Check Kubernetes Secrets

```bash
kubectl --server=http://traefik-iad-acb:8001 get secrets -n drawrace | grep drawrace
```

### Verify OpenBao Secrets (with token)

```bash
export OPENBAO_TOKEN="<your-token>"

# Check API S3 secret
curl -s "http://openbao.external-secrets.svc.cluster.local:8200/v1/secret/data/rs-manager/drawrace/s3" \
  -H "X-Vault-Token: $OPENBAO_TOKEN" | jq '.data.data'

# Check Postgres backup secret
curl -s "http://openbao.external-secrets.svc.cluster.local:8200/v1/secret/data/rs-manager/drawrace/postgres-backup" \
  -H "X-Vault-Token: $OPENBAO_TOKEN" | jq '.data.data'

# Check Postgres credentials secret
curl -s "http://openbao.external-secrets.svc.cluster.local:8200/v1/secret/data/rs-manager/drawrace/postgres" \
  -H "X-Vault-Token: $OPENBAO_TOKEN" | jq '.data.data'
```

---

## Troubleshooting

### Issue: Cannot Obtain OpenBao Root Token

**Solution:** Contact the cluster administrator. The root token is required to write secrets to OpenBao. This is a security measure to prevent unauthorized secret creation.

### Issue: Script Fails with "OPENBAO_TOKEN not set"

**Solution:** Ensure the token is exported:
```bash
export OPENBAO_TOKEN="<your-token>"
echo "Token set: ${OPENBAO_TOKEN:0:8}..."
```

### Issue: ExternalSecrets Still Show SecretSyncedError

**Diagnosis:**
```bash
kubectl --server=http://traefik-iad-acb:8001 get externalsecret drawrace-api-s3-credentials -n drawrace -o yaml | grep -A 5 "message:"
```

**Common causes:**
- Secret path doesn't exist in OpenBao (script didn't complete successfully)
- OpenBao token expired or invalid
- ClusterSecretStore misconfigured

### Issue: Garage Resources Not Created

**Diagnosis:**
```bash
kubectl --server=http://traefik-iad-acb:8001 get garagebucket -n garage-operator
kubectl --server=http://traefik-iad-acb:8001 get garagekey -n garage-operator
```

**Solution:** Ensure you have cluster-admin privileges and Garage operator is running.

---

## Security Notes

1. **OpenBao Root Token:**
   - Treat as highly sensitive credential
   - Store securely (password manager recommended)
   - Rotate regularly (recommend monthly)
   - Never commit to version control

2. **Generated Credentials:**
   - Postgres password uses `openssl rand` (cryptographically secure)
   - S3 credentials auto-generated by Garage operator
   - All credentials stored in OpenBao with access controls

3. **Access Controls:**
   - ExternalSecret operator has read-only access to OpenBao secrets
   - Secrets refresh every hour (automated)
   - Target secrets use `deletionPolicy: Retain`

---

## Documentation Files Created

1. **`docs/openbao-secrets.md`**
   - Secret paths and requirements mapping
   - ExternalSecret to OpenBao path documentation
   - Verification commands

2. **`docs/setup-openbao-secrets.md`**
   - Prerequisites and requirements
   - Automated and manual setup procedures
   - Troubleshooting guide

3. **`docs/openbao-secrets-creation-guide.md`**
   - Comprehensive execution guide
   - Phase-by-phase manual setup steps
   - Detailed verification procedures
   - Rollback procedures

4. **`docs/openbao-secrets-execution-checklist.md`**
   - Step-by-step execution checklist
   - Verification checkboxes
   - Quick troubleshooting reference

5. **`scripts/setup-openbao-secrets.sh`**
   - Automated setup script
   - Creates Garage resources
   - Generates credentials
   - Populates OpenBao secrets
   - Verifies sync success

---

## Next Steps

1. **Obtain OpenBao Root Token** - Contact cluster administrator
2. **Run Setup Script** - Execute `./scripts/setup-openbao-secrets.sh`
3. **Verify Success** - Check ExternalSecret status
4. **Close Bead** - Update bead nd-2636 with completion status

---

## Completion Checklist

**When OpenBao root token is obtained:**

- [ ] Export OPENBAO_TOKEN environment variable
- [ ] Run `./scripts/setup-openbao-secrets.sh`
- [ ] Verify all 3 ExternalSecrets show `SecretSynced` status
- [ ] Verify all 3 Kubernetes secrets created
- [ ] Verify OpenBao secrets accessible
- [ ] Update bead nd-2636 with completion status

**After completion:**

- [ ] Document any issues encountered
- [ ] Update this task summary with final status
- [ ] Close bead nd-2636

---

**Task Summary Version:** 1.0  
**Last Updated:** 2026-07-02  
**Dependencies:** Bead nd-1fnj (documentation completed)  
**Blocks:** None - can proceed once OpenBao root token is obtained
