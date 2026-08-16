# OpenBao Token Request - Infrastructure Team Checklist

**For:** Infrastructure Team  
**Request Date:** 2026-07-03 (Follow-up: 2026-08-16)  
**Project:** DrawRace PWA Backend Deployment  
**Cluster:** rs-manager (Rackspace Spot, us-east-iad-1)

---

## Quick Request Summary

**We need:** OpenBao token with `drawrace/*` path permissions  
**Purpose:** Store deployment secrets (Postgres, S3, Cloudflare tokens)  
**Timeline:** All code ready - <10 minutes to complete once token received

---

## Action Checklist

### Step 1: Provide OpenBao Token

- [ ] **Generate or retrieve OpenBao token**
  - Root token OR scoped token with `drawrace/*` permissions
  - Minimum required permissions:
    ```
    path "drawrace/*" {
      capabilities = ["create", "read", "update", "delete", "list"]
    }
    ```

- [ ] **Confirm OpenBao endpoint URL**
  - Expected: `http://openbao.external-secrets.svc.cluster.local:8200`
  - Provide actual URL if different

- [ ] **Share token securely**
  - DO NOT commit to git
  - Share via secure channel (encrypted message, secrets manager, etc.)
  - Document token rotation policy

### Step 2: Optional - Verify Cluster Access

- [ ] **Confirm kubectl access to rs-manager**
  - Test: `kubectl --server=http://traefik-rs-manager:8001 get nodes`
  - Provide cluster-admin if needed for Garage resource creation

- [ ] **Verify garage-operator CRDs installed**
  - Test: `kubectl get crd | grep garage`
  - Confirm GarageBucket/GarageKey resources available

### Step 3: Token Delivery

**Provide the following to DrawRace team:**

1. **OpenBao Token:** (Secure delivery method)
   ```
   OPENBAO_TOKEN="<provided-token>"
   OPENBAO_ADDR="http://openbao.external-secrets.svc.cluster.local:8200"
   ```

2. **OpenBao Endpoint:** (if different from above)
   ```
   Actual OpenBao URL: _____________________
   ```

3. **Token Expiration:** (if applicable)
   ```
   Token expires: _____________________
   Rotation policy: _____________________
   ```

4. **Cluster Access:** (if providing)
   ```
   kubectl config path: _____________________
   Access level: _____________________
   ```

---

## What Happens Next (Automated)

Once we receive the token, the following will execute **automatically** via existing scripts:

### 1. Token Verification (30 seconds)
```bash
export OPENBAO_TOKEN="<your-token>"
./scripts/verify-openbao-access.sh
```

### 2. Secret Creation (5 minutes)
```bash
./scripts/setup-openbao-secrets.sh
```

**This creates:**
- ✅ Postgres credentials (cryptographically secure password)
- ✅ S3 API credentials (via Garage keys)
- ✅ S3 backup credentials (via Garage keys)
- ✅ ExternalSecrets synced to Kubernetes

### 3. Verification (1 minute)
```bash
kubectl --server=http://traefik-rs-manager:8001 get externalsecrets -n drawrace
```

**Expected result:** All 4 ExternalSecrets showing `SecretSynced` status

---

## OpenBao Secret Paths

The following secrets will be created in OpenBao:

| Path | Keys | Purpose |
|------|------|---------|
| `secret/rs-manager/drawrace/postgres` | username, password | CloudNativePG database |
| `secret/rs-manager/drawrace/s3` | AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_ENDPOINT_URL, AWS_REGION | Ghost blob storage |
| `secret/rs-manager/drawrace/postgres-backup` | accessKeyId, secretAccessKey | Database backups |

---

## Security Checklist

Before providing the token, confirm:

- [ ] Token has minimum required permissions only (not full admin unless necessary)
- [ ] Token expiration policy is documented
- [ ] Token rotation procedure is established
- [ ] Delivery method is secure (not email/plain text)
- [ ] Audit logging is enabled for OpenBao access

---

## Contact & Coordination

**DrawRace Team Contact:** jedarden  
**Repository:** jedarden/drawrace  
**Documentation:** See `OPENBAO_TOKEN_REQUEST_STATUS.md` for full details

**Questions?** 
- OpenBao instance location and configuration
- Token permission scoping  
- Cluster access procedures
- Garage resource creation permissions

---

## Ready to Execute

**All code is complete and tested.** We are waiting **only** for the token delivery.

Once received, the full setup will complete in **<10 minutes** with the following result:

```bash
# Expected final state
kubectl get externalsecrets -n drawrace
# NAME                            STATUS              READY   AGE
# docker-hub-registry             SecretSynced        True    45d
# drawrace-api-s3-credentials     SecretSynced        True    1m
# drawrace-postgres-backup-s3     SecretSynced        True    1m  
# drawrace-postgres-credentials   SecretSynced        True    1m
```

---

**Thank you for your support in unblocking DrawRace deployment!** 🎮

This checklist is designed to make the coordination process as smooth and quick as possible for both teams.
