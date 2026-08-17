# OpenBao Token Request — Action Guide

## Quick Summary

**What:** Need OpenBao root token to set up ExternalSecrets for DrawRace deployment  
**Why:** Script at `scripts/setup-openbao-secrets.sh` requires `OPENBAO_TOKEN` to populate secrets  
**Time:** 5-10 minutes once token is received  
**Security:** Token used only during setup, never stored

---

## Request Template

Send this to the infrastructure team:

---

**Subject:** OpenBao Root Token Request — DrawRace ExternalSecrets Setup

**Request:**
Please provide an OpenBao root token for the DrawRace project. The token will be used to:
1. Create KV secrets at `secret/data/rs-manager/drawrace/*` paths
2. Populate them with S3 and Postgres credentials
3. Enable ExternalSecret operator sync

**Paths to be created:**
- `secret/data/rs-manager/drawrace/s3` (API S3 credentials)
- `secret/data/rs-manager/drawrace/postgres-backup` (Postgres backup S3 credentials)
- `secret/data/rs-manager/drawrace/postgres` (Postgres database credentials)

**How token will be used:**
- Exported as `OPENBAO_TOKEN` environment variable
- Used by automated setup script: `./scripts/setup-openbao-secrets.sh`
- Script runs in single session (~5-10 minutes)
- Token is NOT written to any files or documentation

**Security:**
- Token is only used for initial setup
- After setup, ExternalSecret operator uses OpenBao policies (not root token)
- Recommend rotating root token after setup is complete

**How to provide:**
Please send through a secure channel (direct message, password manager, etc.). Do not email or commit to git.

---

## Once Token is Received

### 1. Set the token securely
```bash
export OPENBAO_TOKEN="<provided-token>"
```

### 2. Run the setup script
```bash
cd /home/coding/drawrace
./scripts/setup-openbao-secrets.sh
```

### 3. Verify ExternalSecrets synced
```bash
kubectl --server=http://traefik-iad-acb:8001 get externalsecrets -n drawrace
```

Expected output:
```
NAME                           READY   STATUS
drawrace-api-s3-credentials    True    SecretSynced
drawrace-postgres-backup-s3    True    SecretSynced
drawrace-postgres-credentials  True    SecretSynced
```

### 4. Clear from shell history
```bash
# Ensure OPENBAO_TOKEN is not in shell history
history -c && history -w
# Or start a new shell session
```

---

## What the Script Does

1. **Creates Garage resources:**
   - `GarageBucket/drawrace-ghosts` (50Gi, versioning enabled)
   - `GarageKey/drawrace-api-key` (S3 access for API)
   - `GarageKey/drawrace-postgres-backup-key` (S3 access for backups)

2. **Generates credentials:**
   - Extracts S3 keys from Garage-generated secrets
   - Generates secure Postgres password

3. **Populates OpenBao:**
   - Writes credentials to KV paths
   - Uses provided `OPENBAO_TOKEN` for authentication

4. **Verifies sync:**
   - Waits for ExternalSecrets to show `SecretSynced`
   - Cleans up temporary secrets

---

## Documentation

- Full details: `docs/openbao-token-request.md`
- Setup script: `scripts/setup-openbao-secrets.sh`
- ExternalSecret manifests: `declarative-config/k8s/rs-manager/drawrace/`

---

## Acceptance Criteria

- [ ] `OPENBAO_TOKEN` received from infrastructure team
- [ ] Token exported to environment (not stored in files)
- [ ] Setup script completes successfully
- [ ] All 3 ExternalSecrets show `SecretSynced` status
- [ ] Token cleared from shell history
- [ ] Token rotated (infrastructure team)

---

**Task ID:** drawrace-16b904bc  
**Parent:** bf-1hab8  
**Blocked by:** External dependency (infrastructure team)
