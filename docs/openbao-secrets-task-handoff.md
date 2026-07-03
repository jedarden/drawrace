# OpenBao Secrets Creation Task - Handoff & Blockers

## Task Summary

**Bead ID:** nd-2636  
**Task:** Create DrawRace secrets in OpenBao  
**Status:** BLOCKED - Requires infrastructure credentials and permissions

## Current State (2026-07-02)

### ExternalSecret Sync Status
```
NAME                            STORETYPE            STORE     REFRESH INTERVAL   STATUS              READY   LAST SYNC
docker-hub-registry             ClusterSecretStore   openbao   1h                 SecretSynced        True    55m
drawrace-api-s3-credentials     ClusterSecretStore   openbao   1h                 SecretSyncedError   False   -
drawrace-postgres-backup-s3     ClusterSecretStore   openbao   1h                 SecretSyncedError   False   -
drawrace-postgres-credentials   ClusterSecretStore   openbao   1h                 SecretSyncedError   False   -
```

**Error Message:** `could not get secret data from provider`

**Root Cause:** The required secrets don't exist in OpenBao.

### OpenBao Configuration
- **Server:** `http://openbao.external-secrets.svc.cluster.local:8200`
- **Status:** Ready ✅
- **Auth Method:** Kubernetes service account (`external-secrets-iad-acb`)
- **ClusterSecretStore:** `openbao` (ReadWrite capability confirmed)

## Required Actions

### 1. Obtain OpenBao Root Token (BLOCKER)

**What:** OpenBao root token for secret creation  
**Why:** The setup script uses OpenBao's API to create secrets, which requires root token authentication  
**How:** Contact infrastructure team or check secure credential store  
**Format:** 
```bash
export OPENBAO_TOKEN="<your-openbao-root-token>"
```

**Security Note:** This token grants administrative access to OpenBao. Handle with extreme care and rotate after use.

### 2. Obtain Cluster Admin Permissions (BLOCKER)

**Current Access:** Read-only via `devpod-observer` service account  
**Required Access:** Cluster admin or equivalent permissions to:
  - Create `GarageBucket` resources in `garage-operator` namespace
  - Create `GarageKey` resources in `garage-operator` namespace
  - Create secrets in `garage-operator` namespace (temporary)

**Why:** The setup script needs to:
1. Create `GarageBucket drawrace-ghosts` (50Gi quota, versioning enabled)
2. Create `GarageKey drawrace-api-key` for API S3 access
3. Create `GarageKey drawrace-postgres-backup-key` for backup S3 access
4. Extract S3 credentials from Garage-generated secrets

### 3. Execute Setup Script

Once credentials and permissions are obtained:

```bash
# Set OpenBao token
export OPENBAO_TOKEN="<your-openbao-root-token>"

# Navigate to repo
cd /home/coding/drawrace

# Execute setup script
./scripts/setup-openbao-secrets.sh
```

**What the script does:**
1. ✅ Checks cluster access
2. ✅ Creates `GarageBucket drawrace-ghosts`
3. ✅ Creates `GarageKey drawrace-api-key`
4. ✅ Creates `GarageKey drawrace-postgres-backup-key`
5. ✅ Extracts S3 credentials from Garage secrets
6. ✅ Generates secure Postgres credentials
7. ✅ Populates OpenBao with secrets at:
   - `secret/data/rs-manager/drawrace/s3` (API S3 credentials)
   - `secret/data/rs-manager/drawrace/postgres-backup` (Postgres backup S3)
   - `secret/data/rs-manager/drawrace/postgres` (Postgres database)
8. ✅ Verifies ExternalSecrets sync
9. ✅ Cleans up temporary Garage secrets

### 4. Verify Success

```bash
# Check ExternalSecret status
kubectl --server=http://traefik-iad-acb:8001 get externalsecrets -n drawrace

# Expected output:
# NAME                            STORETYPE            STORE     REFRESH INTERVAL   STATUS              READY   LAST SYNC
# docker-hub-registry             ClusterSecretStore   openbao   1h                 SecretSynced        True    <timestamp>
# drawrace-api-s3-credentials     ClusterSecretStore   openbao   1h                 SecretSynced        True    <now>
# drawrace-postgres-backup-s3     ClusterSecretStore   openbao   1h                 SecretSynced        True    <now>
# drawrace-postgres-credentials   ClusterSecretStore   openbao   1h                 SecretSynced        True    <now>
```

## Alternative: Manual Secret Creation

If you cannot run the automated script, you can create secrets manually:

### Prerequisites
- OpenBao root token
- S3 credentials (or Garage resources to extract them from)
- Postgres username/password (generate securely)

### Secret Paths and Keys

**API S3 Credentials:** `secret/data/rs-manager/drawrace/s3`
```json
{
  "data": {
    "AWS_ACCESS_KEY_ID": "...",
    "AWS_SECRET_ACCESS_KEY": "...",
    "AWS_ENDPOINT_URL": "https://s3.ardenone.com",
    "AWS_REGION": "garage"
  }
}
```

**Postgres Backup S3:** `secret/data/rs-manager/drawrace/postgres-backup`
```json
{
  "data": {
    "accessKeyId": "...",
    "secretAccessKey": "..."
  }
}
```

**Postgres Credentials:** `secret/data/rs-manager/drawrace/postgres`
```json
{
  "data": {
    "username": "drawrace",
    "password": "..."
  }
}
```

### Manual Creation Commands

```bash
# Set environment variables
export OPENBAO_TOKEN="<your-openbao-root-token>"
export OPENBAO_ADDR="http://openbao.external-secrets.svc.cluster.local:8200"

# Create API S3 secret
curl -s -X POST "$OPENBAO_ADDR/v1/secret/data/rs-manager/drawrace/s3" \
  -H "X-Vault-Token: $OPENBAO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"data":{"AWS_ACCESS_KEY_ID":"...","AWS_SECRET_ACCESS_KEY":"...","AWS_ENDPOINT_URL":"https://s3.ardenone.com","AWS_REGION":"garage"}}'

# Create Postgres backup S3 secret
curl -s -X POST "$OPENBAO_ADDR/v1/secret/data/rs-manager/drawrace/postgres-backup" \
  -H "X-Vault-Token: $OPENBAO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"data":{"accessKeyId":"...","secretAccessKey":"..."}}'

# Create Postgres credentials secret
curl -s -X POST "$OPENBAO_ADDR/v1/secret/data/rs-manager/drawrace/postgres" \
  -H "X-Vault-Token: $OPENBAO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"data":{"username":"drawrace","password":"..."}}'
```

## Acceptance Criteria Verification

After creating secrets, verify:

- [ ] All required secret paths exist in OpenBao
  ```bash
  for path in "rs-manager/drawrace/s3" "rs-manager/drawrace/postgres-backup" "rs-manager/drawrace/postgres"; do
    echo "Checking: $path"
    curl -s -X GET "$OPENBAO_ADDR/v1/secret/data/$path" \
      -H "X-Vault-Token: $OPENBAO_TOKEN" | jq '.data.data | keys'
  done
  ```

- [ ] Each secret contains all required keys/values
  ```bash
  curl -s -X GET "$OPENBAO_ADDR/v1/secret/data/rs-manager/drawrace/s3" \
    -H "X-Vault-Token: $OPENBAO_TOKEN" | jq '.data.data | keys'
  # Expected: ["AWS_ACCESS_KEY_ID", "AWS_ENDPOINT_URL", "AWS_REGION", "AWS_SECRET_ACCESS_KEY"]
  ```

- [ ] Secrets are accessible to the ExternalSecretOperator service account
  ```bash
  kubectl --server=http://traefik-iad-acb:8001 get externalsecrets -n drawrace
  # Expected: All STATUS = SecretSynced, READY = True
  ```

## Documentation References

- **Main documentation:** `docs/openbao-secrets.md`
- **Setup guide:** `docs/openbao-secrets-creation-guide.md`
- **Execution checklist:** `docs/openbao-secrets-execution-checklist.md`
- **Setup script:** `scripts/setup-openbao-secrets.sh`

## Security Considerations

1. **OpenBao Root Token:**
   - Treat as highly sensitive credential
   - Rotate after use
   - Never commit to version control
   - Revoke after secret creation is complete

2. **Generated Credentials:**
   - Postgres password should be cryptographically secure (use `openssl rand -base64 32`)
   - S3 credentials are automatically generated by Garage operator
   - All credentials stored in OpenBao with access controls

3. **Access Controls:**
   - ExternalSecret operator service account has limited read-only access
   - Consider implementing OpenBao policies for least-privilege access

## Next Steps

1. **Contact infrastructure team** to obtain:
   - OpenBao root token (or permission to create one)
   - Cluster admin permissions on iad-acb

2. **Run setup script** with proper credentials

3. **Verify ExternalSecrets sync** successfully

4. **Test DrawRace deployment** to ensure pods can start with new credentials

## Blocker Summary

| Blocker | Required From | Status |
|---------|---------------|--------|
| OpenBao root token | Infrastructure team | ❌ Not obtained |
| Cluster admin permissions | Infrastructure team | ❌ Not granted |
| S3 credentials (if not using Garage) | Garage operator | ✅ Can generate via script |
| Postgres credentials | Script (generate securely) | ✅ Can generate via script |

---

**Document Version:** 1.0  
**Created:** 2026-07-02  
**Bead ID:** nd-2636
