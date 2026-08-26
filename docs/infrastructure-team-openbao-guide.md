# Infrastructure Team Guide: DrawRace OpenBao Token Setup

## Quick Summary

The DrawRace deployment needs an OpenBao root token to complete the secrets setup. This guide explains exactly what's needed and how to provide it securely.

**Time required:** 5-10 minutes once you have the token  
**Security:** Token is used only for setup, never stored  
**Impact:** Unblocks DrawRace production deployment

---

## What is OpenBao and Why Do We Need a Token?

OpenBao is a secrets management system (similar to HashiCorp Vault). DrawRace uses it to securely store:
- S3 credentials for ghost blob storage
- Postgres database credentials  
- Backup credentials

The ExternalSecret operator needs to read these secrets and sync them to Kubernetes. To create the initial secrets, we need an OpenBao root token.

**Security note:** This is a one-time setup. After the secrets are created, the ExternalSecret operator uses OpenBao policies (not the root token) for ongoing access.

---

## What We Need From You

### 1. OpenBao Root Token

Provide a root token for the OpenBao cluster. This token will be used to:
- Create KV secret paths at `secret/data/rs-manager/drawrace/*`
- Populate them with S3 and Postgres credentials
- Enable ExternalSecret operator access

### 2. How to Provide the Token

**Send through a secure channel:**
- Direct message (Slack, Teams, etc.)
- Password manager shared entry
- Encrypted file
- **Do NOT** email it
- **Do NOT** commit it to git

### 3. Token Format

OpenBao root tokens typically look like:
```
s.<random-string>
```

Example (not a real token): `s.1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef`

---

## Setup Process (What Happens After You Provide the Token)

### Step 1: Set the Token
```bash
export OPENBAO_TOKEN="<token-you-provide>"
```

### Step 2: Run the Setup Script
```bash
cd /home/coding/drawrace
./scripts/setup-openbao-secrets.sh
```

The script will:
1. Create Garage resources (S3 buckets and access keys)
2. Generate secure Postgres credentials
3. Populate OpenBao secrets using your token
4. Verify ExternalSecrets are syncing
5. Clean up temporary secrets

### Step 3: Verify It Worked
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

### Step 4: Security Cleanup
```bash
# Clear token from shell history
history -c && history -w

# Or start a new shell session
```

---

## What Gets Created

### OpenBao Secrets (at these paths)
```
secret/data/rs-manager/drawrace/s3              - API S3 credentials
secret/data/rs-manager/drawrace/postgres-backup - Postgres backup S3 credentials  
secret/data/rs-manager/drawrace/postgres        - Postgres database credentials
```

### Kubernetes Secrets (synced by ExternalSecrets)
```
drawrace-api-s3-credentials     - 4 keys (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_ENDPOINT_URL, AWS_REGION)
drawrace-postgres-backup-s3     - 2 keys (accessKeyId, secretAccessKey)
drawrace-postgres-credentials   - 2 keys (username, password)
```

### Garage Resources
```
GarageBucket/drawrace-ghosts           - 50Gi quota, versioning enabled
GarageKey/drawrace-api-key             - S3 access key for API
GarageKey/drawrace-postgres-backup-key - S3 access key for backups
```

---

## Security Assurance

### Token Handling
- ✅ Token is exported as environment variable only
- ✅ Never written to files or documentation
- ✅ Cleared from shell history after use
- ✅ Recommended to rotate after setup

### Least Privilege
- ✅ Root token used only for initial secret creation
- ✅ ExternalSecret operator uses OpenBao policies for ongoing access
- ✅ No long-lived root tokens in production

### Verification
You can verify the ExternalSecret operator is using policies (not root token) by checking:
```bash
kubectl --server=http://traefik-iad-acb:8001 get secret drawrace-externalsecret-token -n drawrace
```

This should show a restricted token, not the root token.

---

## Troubleshooting

### "OPENBAO_TOKEN not set" Error
**Cause:** Token environment variable not set  
**Fix:** `export OPENBAO_TOKEN="<your-token>"`

### "could not get secret data from provider"
**Cause:** OpenBao secrets don't exist yet  
**Fix:** Run the setup script with the token

### ExternalSecrets show "SecretSyncedError"
**Cause:** OpenBao path doesn't match ExternalSecret spec  
**Fix:** Verify paths in `scripts/setup-openbao-secrets.sh` match ExternalSecret manifests

### "Permission denied" accessing Garage resources
**Cause:** Insufficient cluster permissions  
**Fix:** Ensure you have cluster-admin or equivalent on `iad-acb`

---

## Additional Resources

### Documentation
- **Full setup details:** `docs/openbao-token-request.md`
- **Action guide:** `docs/openbao-token-action-guide.md`
- **Permissions request:** `docs/infrastructure-permissions-request.md`
- **Script source:** `scripts/setup-openbao-secrets.sh`

### ExternalSecret Manifests
Location: `jedarden/declarative-config/k8s/rs-manager/drawrace/`
- `externalsecrets-s3.yaml`
- `externalsecrets-postgres.yaml`

---

## Contact and Next Steps

**When you're ready to provide the token:**
1. Send it through a secure channel (DM, password manager, etc.)
2. Include a note that it's for "DrawRace OpenBao setup"
3. We'll run the setup script and verify everything works

**After setup is complete:**
1. We'll confirm all ExternalSecrets show `SecretSynced`
2. We'll clear the token from our environment
3. We recommend you rotate the root token

**Questions?**
- Check the troubleshooting section above
- Review the full documentation in `docs/openbao-*`
- Contact the DrawRace team

---

## Acceptance Checklist

Use this to verify the setup is complete:

- [ ] OpenBao root token provided (securely)
- [ ] Token exported to environment (not in files)
- [ ] Setup script runs without errors
- [ ] All 3 ExternalSecrets show `SecretSynced` status
- [ ] Token cleared from shell history
- [ ] Root token rotation recommended

---

**Task ID:** drawrace-16b904bc  
**Parent:** bf-1hab8  
**Blocked by:** External dependency (infrastructure team)  
**Priority:** P0 - Critical blocker for DrawRace deployment

---

*This guide is maintained in `/home/coding/drawrace/docs/infrastructure-team-openbao-guide.md`*